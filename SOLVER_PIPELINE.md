# Production Solver Pipeline

This document describes the current solver architecture in
[solver_pipeline.js](solver_pipeline.js) (as of the single-LP rewrite).
`runSolver` in that file is the entry point.

If you only have time for one section, read **The end-to-end flow**.
If you're modifying the solver, read **Graph construction**, **Why the LP can
go Unbounded**, and **Known traps** before touching anything.

---

## What problem does this solve?

Given:

- A list of **production targets** (items the user wants to produce)
- **Raw resource caps** (e.g. 590 Originium Ore/min, 600 Water/min)
- **Facility caps** (e.g. 12 Forge of the Sky units)
- Optional **locked/pinned rates** (user pins a target's rate)

Produce a recipe schedule that maximises total profit (sell price × rate)
and respects every cap. The schedule comes out as `recipeId → facility count`
(how many of each building to run), from which the UI derives per-item rates
and resource/facility usage bars.

Power (battery) consumption is **not** part of the LP — it is subtracted from
the net-rate display in `computeSummary` after solving.

---

## The end-to-end flow

`runSolver` is six phases (look for the `─── Phase N ───` banners in the source):

```
  production[], rawLimits, facilityLimits
                     │
    Phase 1 ─────────┤  buildBipartiteGraph
                     │    Step 1 — DFS from each target; pick one recipe per
                     │             item via selectRecipe
                     │    Step 2 — Augment: add FD-byproduct recycler recipes
                     │             (e.g. xiranite lowpoly purifier)
                     │    Step 3 — Cycle repair: inject alternate recipe for
                     │             any item stranded without a raw-material path
                     │
    Phase 2 ─────────┤  Build LP model
                     │    Variables:
                     │      x_ri       facility count for recipe r  (≥ 0)
                     │      surp_X     surplus absorber for zero-price dead ends
                     │    Constraints:
                     │      bal_X      Σ net_production(X) ≥ 0
                     │                 (= pinnedRate for pinned items)
                     │      raw_R      Σ raw consumption ≤ rawCap
                     │      fac_F      Σ facility counts ≤ facCap
                     │      ub_net_X   net_production(X) ≤ soloMaxRate[X]
                     │    Objective:
                     │      max  Σ price(X) · net_rate(X)
                     │         − SURPLUS_PENALTY · Σ surp_X
                     │         − MACHINE_PENALTY · Σ x_ri
                     │
    Phase 3 ─────────┤  Solve via HiGHS (CPLEX LP text → WebAssembly)
                     │
    Phase 4 ─────────┤  Extract recipeFacilityCounts from x_ri solution values
                     │
    Phase 5 ─────────┤  Sanity check — abort if any cap exceeded by > 0.5
                     │
    Phase 6 ─────────┤  Apply results
                     │    Snap LP residuals < 1e-3 to 0
                     │    Write p.rate for non-fixed items
                     │    Cache _lastGraph / _lastFacilityCounts
                     │    computeSummary() + render
```

---

## Solver adapter (HiGHS)

All LP calls go through a small adapter at the top of `solver_pipeline.js`:

- `compileLP(model)` serialises the internal model object
  `{ optimize, opType, constraints: {name: {max|min|equal}},
  variables: {name: {[constraintOrObj]: coef}} }`
  into CPLEX LP text. Variables default to ≥ 0 (no explicit Bounds section —
  that's correct for facility counts and surplus variables).
- `solveLP(model)` runs the text through `_highs.solve(...)` and reshapes
  the result into `{ feasible: bool, result: number, [varName]: value }`,
  so neither `solveItemMax` nor `runSolver` has to deal with HiGHS' internal
  return shape.

HiGHS is a WebAssembly module. `index.html` awaits `Module({...})` and then
calls `setHighsInstance(solver)` to install the resolved object. While
`_highs` is null, `isHighsReady()` returns false and `runSolver` short-
circuits with "LP solver not loaded yet".

The adapter is the only place that mentions CPLEX LP syntax. Swap
`compileLP` + `solveLP` to change solvers without touching anything else.

---

## Phase 1: Graph construction

### selectRecipe(recipes, visitedPath)

Picks one recipe for an item from a list of candidates. Filter cascade:

1. Drop dismantle recipes (recipes that consume filled-bottle items — these
   are byproduct-sink sinks, not real producers).
2. Drop disposal-only recipes (every input is a forced-disposal item; these
   re-enter via augmentation as recyclers, not as primary producers).
3. Prefer single-output recipes.
4. Within each tier, prefer a recipe whose every input is a raw material
   (terminates DFS immediately, avoids synthetic cycles).
5. If a visitedPath is provided, break ties by preferring non-circular
   candidates (no input already on the DFS stack).

### buildBipartiteGraph(targetIds, recipeOverrides)

Three-step construction:

**Step 1 — DFS.** Starting from each target item, pick one recipe via
`selectRecipe`, recurse into its inputs. Stop at `forcedRawSet` items or
dead-end items (no producer in the recipe data — treated as raw).
`recipeOverrides` lets the user pin a specific recipe for an item.

**Step 2 — Augmentation.** Scan all recipes already in the graph. For each
forced-disposal output of an existing recipe, look up consuming recipes. A
consuming recipe is added if:

- All its inputs are forced-disposal (`isDisposalOnlyRecipe`).
- It produces at least one item already in the graph.

This brings in recycler recipes like `liquid_purifier_xiranite_poly_1` that
convert waste `lxp_lowpoly` back to useful `lxp`. The all-FD-input guard is
critical — without it, alternate normal producers would be included and break
the LP's balance equations.

**Step 3 — Cycle repair.** Compute which items are reachable forward from raw
materials through the current recipes. Any item not yet reachable (trapped in a
cycle with no raw-material entry point) gets a new recipe injected: one not
already in the graph whose every input is reachable or raw. Repeat until
the reachable set stabilises.

#### Graph shape

```
graph = {
  itemNodes:      Map<itemId, { isRawMaterial: bool }>,
  recipeNodes:    Map<recipeId, recipe>,
  itemConsumedBy: Map<itemId, Set<recipeId>>,
  itemProducedBy: Map<itemId, Set<recipeId>>,
  recipeInputs:   Map<recipeId, Set<itemId>>,
  recipeOutputs:  Map<recipeId, Set<itemId>>,
  targets:        Set<itemId>,
  rawMaterials:   Set<itemId>,
}
```

---

## Phase 2: LP construction

### Variables

- `x_ri` (one per recipe in the graph, ≥ 0): facility count for recipe `r`.
  The LP optimises these. Post-solve, `x_ri` values are the `recipeFacilityCounts`.
- `surp_X` (one per zero-price dead-end item): surplus absorber. See below.

### Balance constraints (bal_X)

For every non-raw item X:

```
Σ_r outputRate(r, X) · x_r  −  Σ_r inputRate(r, X) · x_r  ≥  0
```

If item X is pinned (locked or `tempPinnedId`), the bound becomes `= pinnedRate`
instead of `≥ 0`. Fixed items at rate ≈ 0 are excluded from pinning so the LP
treats them as free.

### Raw/facility caps (raw_R, fac_F)

Standard linear capacity constraints:

```
raw_R:  Σ_r rawConsumption(r, R) · x_r  ≤  rawCap[R]
fac_F:  Σ_r (1 if r uses facility F) · x_r  ≤  facCap[F]
```

### Net-production upper bounds (ub_net_X)

For every priced non-pinned item X:

```
Σ_r net_rate(r, X) · x_r  ≤  soloMaxRate[X]
```

`soloMaxRate[X]` is the maximum rate achievable for X alone (from a mini-LP
or facility-ceiling fallback). These constraints prevent the profit objective
from becoming unbounded when self-sustaining production cycles (e.g. the
moss/seed loop) exist without any caps. See **Why the LP can go Unbounded**.

### Profit objective

```
max  Σ_X price(X) · net_rate(X)
   − SURPLUS_PENALTY · Σ_X surp_X
   − MACHINE_PENALTY · Σ_r x_r
```

`SURPLUS_PENALTY` (default 0.05) nudges the LP away from generating
zero-price dead-end byproducts as a side-effect of running a recipe.
`MACHINE_PENALTY` (default 0.001) discourages unnecessary intermediate steps
when multiple routes yield equal profit.
Both weights are configurable in `assets/solver_config.js`.

### Surplus variables

A dead-end item is one that is:

- Not a production target
- Not priced
- Not consumed by any recipe in the graph

For each such item, the balance constraint is promoted from `≥ 0` to `= 0`,
and a `surp_X` variable absorbs any over-production:

```
surp_X  contributes  -1  to  bal_X
surp_X  contributes  -SURPLUS_PENALTY  to  profit
```

Without the surplus variable, `= 0` would make the LP infeasible whenever
a recipe unavoidably generates a dead-end byproduct as a side-effect.

---

## Why the LP can go Unbounded

If a self-sustaining cycle (no external raw inputs) has a positive-price
output and there are no raw or facility caps, the LP objective has no upper
bound — HiGHS returns Infeasible or Unbounded. The fix is the `ub_net_X`
constraints above.

`soloMaxRate[X]` is computed by `solveItemMax`: a mini-LP identical to the
global LP but with a single-item objective and no pinned items. If HiGHS
is not yet loaded, a simpler facility-ceiling fallback is used instead.

Results are memoised in `_maxCache` (keyed by item + recipe + limits
fingerprint). The persistent `_soloMaxMap` is rebuilt lazily — only when
`_soloMaxDirty` is true, which is set by `invalidateMaxCache()` whenever
limits or item list changes. During drag, the map is reused as-is (`solo=0.0ms`
in the timing log).

---

## Phase 6: Apply and residual snapping

After Phase 5 sanity-checks the solution:

1. `computeNetRatesFromFlow` derives net item rates from `recipeFacilityCounts`.
2. For each non-fixed production item, LP residuals below `1e-3` are snapped
   to exactly 0. This prevents `p.rate = 3.7e-7` from appearing as `0.001`
   on the slider during drag.
3. `p.rate` is written for each non-fixed item.
4. `_lastGraph` and `_lastFacilityCounts` are cached for `computeSummary`.
5. `computeSummary` (in `endfield_calculator.js`) reads `p.rate` directly
   (not `computeNetRatesFromFlow`) so sliders and the summary always agree.

---

## Power consumption (batteries)

Battery items are **not** LP constraints. They are a post-solve display
subtraction applied in `computeSummary`:

```javascript
powerBatteries.forEach((pb) => {
  netRates[pb.matId] = (netRates[pb.matId] || 0) - pb.rate;
});
```

A battery item that is also a production target shows a reduced net rate.
A battery item that is NOT a production target appears as a negative line
item (pure cost) in the summary table and saved-production cards.

---

## Glossary

| Term                          | Meaning                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| **Target**                    | An item with a user-requested rate. Lives in `production[]`.                                     |
| **Recipe**                    | Game recipe: `{ id, facilityId, craftingTime, inputs[], outputs[] }`.                            |
| **FD item / forced-disposal** | Item in `forcedDisposalSet` (e.g. sewage, lxp_lowpoly). Free to over-produce.                    |
| **Raw material**              | Item in `forcedRawSet` (e.g. ore, water). Unlimited supply, capped only by `rawLimits[]`.        |
| **Pinned item**               | A fixed item (`p.locked` or `p.id === tempPinnedId`) with rate > 0. Gets an `equal:` constraint. |
| **x_ri**                      | LP variable: facility count for recipe r. Directly gives `recipeFacilityCounts`.                 |
| **soloMaxRate[X]**            | Maximum rate of item X if it were the only target given current caps.                            |
| **calcRate(amt, ct)**         | `amt/ct × 60` — converts "qty per craft" to "qty/min per facility".                              |
| **surp_X**                    | Surplus variable for zero-price dead-end item X.                                                 |

---

## Forced-disposal semantics

`forcedDisposalSet` lists items the game treats as free recyclable byproducts:
sewage, lxp_lowpoly, lxp. The pipeline treats them as:

- Not charged as raw costs (they come from other recipes for free).
- Not subject to the surplus-variable penalty (they're expected to be over-produced).
- Starting points for the augmentation pass (their consumers may be recycler recipes).

What FD does NOT mean:

- The item is never consumed. lxp is FD but Heavy Xiranite needs it.
- You can skip producing it. Within the LP, balance still holds; the LP just
  doesn't penalise over-production.

---

## Known traps when modifying

- **Adding a recipe to the graph by hand:** use `addRecipeToGraph` inside
  `buildBipartiteGraph` — it maintains all four index maps consistently.
  Skipping any map will cause the graph to be silently incomplete.

- **Changing the augmentation criterion:** anything other than
  `isDisposalOnlyRecipe(cons)` can let in alternate normal producers. They
  form unexpected multi-producer groups that the single-recipe LP didn't
  account for, leading to wrong or missing balance equations.

- **Facility cap = 0:** the `ub_net_X` guard uses `mx === undefined || mx ===
null || !isFinite(mx)` — NOT `!mx`. Zero is a valid upper bound (facility
  cap=0 means the item can't be produced). The `solveMaxForItem` fallback
  likewise uses `>= 0` not `> 0`.

- **Pinned items at rate ≈ 0:** these are excluded from `pinnedIds`. A
  `equal: 0` equality constraint is almost always unintentional (e.g. the
  user dragged a slider to the left edge). Free (`min: 0`) is the safer default.

- **Residual snap threshold 1e-3:** if you tighten it below LP arithmetic
  noise, you'll see phantom non-zero rates. If you loosen it above real
  minimum production rates, you'll accidentally zero out legitimate results.

---

## Where to look for what

| If you want to …                    | Look at                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| Change recipe-pick heuristic        | `selectRecipe` in `solver_pipeline.js`                      |
| Add a new raw resource              | `rawLimits[]` + `raw_R` constraint loop in `runSolver`      |
| Add a new facility type             | `facilityLimits[]` + `fac_F` constraint loop in `runSolver` |
| Debug "why isn't recipe X running?" | Log `recipeFacilityCounts` after Phase 4                    |
| Debug "why is item X at 0?"         | Check `soloMaxRate[X]`; if 0, a cap is binding              |
| Verify caps hold                    | Phase 5 sanity check (`rawAndFacilityUsage`)                |
| Swap the LP solver                  | `compileLP` + `solveLP` in `solver_pipeline.js` § 1         |
| Change surplus penalty              | `assets/solver_config.js` → `weights.surplus`               |
| Change machine penalty              | `assets/solver_config.js` → `weights.machine`               |
| Understand battery display          | `computeSummary` in `endfield_calculator.js`                |

---

## Reading order for a newcomer

1. Skim this doc top to bottom.
2. Read `runSolver` end to end in `solver_pipeline.js` — the phase banners match this doc.
3. Read `buildBipartiteGraph` — the structural decisions here shape everything the LP sees.
4. Read `selectRecipe`, `isDismantleRecipe`, `isDisposalOnlyRecipe` — understand why certain recipes are filtered.
5. Read the augmentation pass in `buildBipartiteGraph` — this is where recyclers enter.
6. Glance at `compileLP` + `solveLP` — know what the LP rows look like when handed to HiGHS.
7. Read `solveItemMax` + `solveMaxForItem` — understand how soloMaxRate is computed and cached.
