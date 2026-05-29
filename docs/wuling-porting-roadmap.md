# Wuling Stock Bill Porting Roadmap

This repository is based on the lightweight AIC solver pipeline. The Wuling
Stock Bill work should preserve that lightweight single-LP foundation while
porting the decision-support ideas proven in `../wuling-stock-bill-guide`.

For the current module boundaries after the porting work, see
[`architecture.md`](architecture.md).
For the current candidate-generation behavior, see
[`candidate-generation.md`](candidate-generation.md).

`../wuling-stock-bill-guide` is a reference source only. Do not edit it when
working in this repository.

## Current Baseline

The inherited solver has a compact architecture:

- one recipe variable per recipe
- one balance constraint per non-raw item
- raw-resource and facility-cap constraints
- optional integer facility variables through HiGHS `General`
- a small objective penalty for surplus, machine count, and power

This is a good foundation for Wuling because it can solve broad recipe graphs
quickly and can try many candidate variants without turning every decision into
a large custom MILP.

## Wuling Ideas To Preserve

The new implementation should keep these product ideas from the previous guide:

- Compare candidates rather than present a single answer.
- Separate an exchange-only design from a deduction-aware result.
- Show why the final bill value changed after batteries or equipment parts.
- Prefer practical candidates that are easier to build, especially plans where
  high-value final recipe facility counts are near integers.
- Keep visual comparison compact enough for players, with detailed text moved
  into optional guides.
- Keep URL state shareable, but avoid storing every view preference in the URL.

## Solver Direction

The AIC-style single global LP should remain the default path.

Instead of adding many sequential solve passes first, prefer:

1. A strong primary objective for Wuling Stock Bill value.
2. Small, documented tie-breakers for power and facility count when they cannot
   reduce bill value.
3. Targeted MIP only for practical integer variants.
4. Post-solve diagnostics for physical concerns such as ports or fluid handling
   before making them hard constraints.

This keeps the common path fast while leaving room for stricter modes later.

## First Migration Targets

1. **Scenario layer**
   Define Wuling trade items, constrained resources, facility caps, and
   deductions as configuration over the existing catalog.
   Initial browser configuration lives in
   `src/scenario/wuling-stock-bill.js`; it should remain the first place to
   check before hard-coding Wuling-specific items in UI or solver code.

2. **Candidate policies**
   Add Wuling-specific policies for:
   - low-power maximum bill candidates
   - practical integer candidates
   - resource-boost variants
   The first policy metadata lives in
   `src/scenario/candidate-policies.js`. Keep this list small for the default
   UI; hidden baseline policies can exist for internal comparison.
   `src/scenario/candidate-engine.js` turns those policy definitions into
   concrete candidate requests by combining each visible policy with the
   scenario resource-boost variants. Policy-specific solve behavior should be
   centralized in `solveOptionsForPolicy` so the labels, docs, and execution do
   not drift apart.

   Current status: the default table is centered on the selected/current plan,
   the low-power maximum baseline, and nearby variants. Nearby now owns most
   practical-build exploration, including integer final-recipe counts and
   simple low-facility snap points (`1/2u`, `1u`) for small but valuable items.

3. **Deduction-aware display**
   Compute an exchange-only plan and a deduction-aware view so users can see:
   - design production
   - direct deduction
   - solver adjustment
   - final bill output
   `src/scenario/snapshot.js` defines the immutable state snapshots that should
   be passed through this flow. Candidate generation should clone snapshots
   instead of mutating the live UI state directly.

   The current bridge is `solveProductionModel()` in `src/solver_pipeline.js`.
   It extracts the LP solve from the legacy `runSolver()` UI wrapper and
   returns graph, recipe counts, net rates, and usage without applying rates to
   the screen. `solveProductionModel({ context })` solves a cloned
   snapshot/context without mutating the live side pane. The model builder now
   reads production, resource limits, facility limits, prices, and policy flags
   from that explicit context.
   Candidate requests carry both:
   - `exchangeSnapshot`: deductions removed, used to design the target output.
   - `deductionSnapshot`: deductions retained, used to evaluate the same design
     after equipment/battery consumption.
   `src/scenario/deductions.js` normalizes the inherited `powerBatteries`
   representation into Wuling deductions before building these snapshots.
   `src/scenario/solution-summary.js` then converts solve results into
   user-facing concepts such as design rate, direct deduction, solver
   adjustment, final rate, bill totals, and cap usage.

4. **Detail drilldown**
   Port the compact drilldown ideas:
   - bill composition
   - constrained resource bars
   - facility mix
   - fraction splitter guide
   - endfield-calc link

   Current status: the detail panel shows design, direct deduction, solver
   adjustment, final output, bill contribution, constrained resource usage,
   selected shared-material usage, facility mix, and a collapsible fraction
   splitter guide.

5. **Guides**
   Recreate only the useful guide pages, with screenshots generated from this
   app once the UI stabilizes.

## Known Risks

- Port constraints are not modeled yet. Start with warnings and diagnostics.
- Water, acid, sewage, effluent, and reusable fluid handling can affect trust in
  the result. Keep these balances visible before adding hard physical rules.
- Equipment and battery deductions are a design assumption, not just a display
  feature. The default mode should remain explicit: design first, then evaluate
  the deduction-aware result.
- Too many solve passes can make candidate generation slow. Prefer one-pass
  tie-breakers where the value loss can be guarded by constraints.
- Data correctness matters more than solver cleverness. Imported recipe
  coefficients should be validated and diffable between game versions.

## Working Rule

Before changing assets or recipe data, check which repository is active.

- Work target: this repository.
- Reference only: `../wuling-stock-bill-guide`.
- Reference only: `../endfieldIndustry`.
- Reference/source data: `../aic-solver`.
