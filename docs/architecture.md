# Architecture

This document records the current module boundaries after the fork migration.
It is meant to help future changes avoid putting more Wuling-specific behavior
back into the inherited app shell.

## Current Shape

The app has three layers.

1. **Catalog and solver foundation**

   - `assets/items.json`
   - `assets/recipes.json`
   - `assets/solver_config.js`
   - `src/solver_pipeline.js`

   This layer is intentionally close to the base AIC-style solver. It builds one
   global LP from recipe variables, material balance constraints, raw-resource
   limits, facility limits, and small objective tie-breakers.

2. **Wuling scenario and candidate layer**

   - `src/scenario/wuling-stock-bill.js`
   - `src/scenario/state.js`
   - `src/scenario/snapshot.js`
   - `src/scenario/deductions.js`
   - `src/scenario/solver-kernel.js`
   - `src/scenario/solver-service.js`
   - `src/scenario/candidate-policies.js`
   - `src/scenario/candidate-neighborhood.js`
   - `src/scenario/candidate-engine.js`
   - `src/scenario/candidate-buildability.js`
   - `src/scenario/solution-summary.js`

   This is the main extension layer. New Wuling behavior should normally start
   here.

   The candidate flow is:

   1. Take a snapshot of the current side-pane state.
   2. Build resource-boost variants.
   3. Build exchange-only snapshots to design the candidate.
   4. Build deduction-aware snapshots to evaluate the same design after battery
      and equipment-part consumption.
   5. Solve both views.
   6. Convert solver output into bill composition, cap usage, facility mix, and
      buildability metadata.
   7. Filter/rank for display.

   Visible default policies are intentionally small. Practical integer variants
   are currently expected to come mainly from the nearby candidate generator,
   not from a separate visible `practical-integer` policy.

   See [`candidate-generation.md`](candidate-generation.md) for the current
   nearby, deduction, dedupe, and detail-panel behavior.

3. **UI layer**

   - `src/ui/production.js`
   - `src/ui/candidate-controller.js`
   - `src/ui/candidate.js`
   - `src/ui/detail-helpers.js`
   - `src/ui/detail-export.js`
   - `src/ui/detail.js`
   - `styles/production.css`
   - `styles/candidate.css`
   - `styles/detail.css`

   The UI layer should render data prepared by the scenario layer. It should not
   decide solver policy or mutate candidate snapshots.

## Legacy Shell

`src/endfield_calculator.js` still owns a lot of inherited behavior:

- side-pane state arrays
- URL and localStorage persistence
- raw/facility/deduction input rendering
- search dropdowns
- legacy tabs
- legacy production summary rendering
- calls into the Wuling candidate controller

This is acceptable for now, but new Wuling candidate logic should not be added
there. If a change starts to need solver policy, candidate generation, or
deduction semantics, move that behavior into `src/scenario/` and call it from
the shell.

## Known Boundaries To Watch

- **Candidate generation cost**
  Nearby variants can grow quickly because each visible candidate may require
  both exchange and deduction solves. Keep generated variants deliberate and
  observable. The current generator includes low-facility snap variants for
  small final-recipe counts, so changes to nearby breadth should be tested
  against both row count and attempted solve count.

- **Deduction semantics**
  The default model is design first, then evaluate deductions. This matches the
  current user workflow, but it is a product assumption and should remain
  explicit in UI and docs.

- **Physical constraints**
  Port constraints and detailed fluid routing are not hard constraints yet.
  Keep resource and shared-material usage visible before turning those concerns
  into stricter solver rules.

- **Selected candidate**
  The selected/current production candidate is intentionally preserved during
  dedupe, but it can still be hidden if either its exchange solve or deduction
  solve is infeasible.

- **Display dedupe**
  Candidate dedupe uses display-like output and resource keys, not raw policy
  IDs. This keeps different nearby search paths from producing duplicate rows
  when the visible result is the same.

- **Legacy summaries**
  `index.html` still contains legacy summary containers. They are hidden or
  secondary in the Wuling layout, but their code paths still exist in the shell.
  Remove them only after the Wuling detail panel covers the needed diagnostics.

## Test Coverage

The current tests cover:

- file/module structure
- scenario references and default state
- snapshot cloning
- deduction-aware snapshots
- candidate policies
- candidate neighborhood generation
- candidate solving/ranking
- solution summary math
- candidate and detail rendering helpers
- solver pipeline boundaries

When changing candidate generation or deduction rules, add or update tests near:

- `test/candidate-engine.test.js`
- `test/candidate-neighborhood.test.js`
- `test/solution-summary.test.js`
- `test/regression-baseline.test.js`

## Working Rule

Reference repositories:

- `../wuling-stock-bill-guide`
- `../endfieldIndustry`
- `../aic-solver`

Use them for comparison only. The active implementation is this repository.
