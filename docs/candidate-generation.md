# Candidate Generation

This document explains how the Wuling candidate table is built. It is written
for developers who need to change candidate policies without changing the
meaning of the UI by accident.

## Goal

The app is not trying to return a single mathematical optimum. It tries to show
a small set of useful plans:

- a strong low-power baseline;
- the user's currently selected production plan, when feasible;
- nearby practical variants that are easier to build or adjust.

The important product assumption is:

1. design an exchange-material production plan first;
2. evaluate what happens after battery/equipment deductions consume resources.

That means the candidate table usually shows **design rates** for products, but
uses the deduction-aware solve for bills, resources, facilities, and detail
diagnostics.

## Main Modules

- `src/scenario/candidate-engine.js`
  Builds candidate requests, runs exchange/deduction solves, deduplicates, and
  ranks rows.

- `src/scenario/candidate-policies.js`
  Defines the small set of baseline policies.

- `src/scenario/candidate-neighborhood.js`
  Generates nearby fixed-rate and fixed-facility-count variants.

- `src/scenario/candidate-buildability.js`
  Adds splitter/buildability metadata used for ranking and the detail panel.

- `src/scenario/solution-summary.js`
  Converts solver output into bill composition, raw usage, facility usage, and
  shared-material summaries.

- `src/scenario/candidate-apply.js`
  Applies a candidate row back to the Production panel.

## Input Snapshot

Candidate generation starts from a side-pane state snapshot:

- production targets and pins;
- raw resource limits;
- facility limits and integer toggles;
- selected transfer boost;
- deduction rates;
- recipe switches such as the Purification Node route.

The scenario layer should work from snapshots. UI code should not decide solver
policy directly.

## Transfer Variants

Each candidate source is evaluated under transfer variants from the scenario
definition. Currently the visible variants are:

- high-density Originium powder boost;
- Ferrium ore boost.

The UI labels this area as `Transfer`. The boost is part of candidate identity,
ranking, and dedupe.

## Candidate Sources

The default visible table is intentionally small.

### Selected

`selected` means the current Production panel values.

It is useful because users often want to know whether their current manual plan
is feasible. Selected rows are preserved during dedupe: if another policy
produces the same visible result, the selected row wins.

The selected policy uses a small tolerance instead of exact equality. This is
necessary because the Production panel may display rounded values while the
solver uses floating-point values.

### Low Power Max

`power` is the main continuous baseline. It is conceptually:

1. maximize Wuling Stock Bills;
2. within that optimum, prefer lower power;
3. then prefer fewer facilities.

This follows the base solver style: one LP handles the recipe graph, and
secondary preferences are expressed as tie-breakers instead of separate UI
policies.

### Nearby

`nearby` generates practical alternatives around the low-power baseline.

Nearby does not replace the baseline. It gives users buildable variants near a
good solution, especially where exact optimal rates are awkward to build.

## Exchange Solve And Deduction Solve

Most candidate rows have two solves.

1. **Exchange solve**
   Deductions are disabled. This creates the intended exchange-material rates.

2. **Deduction solve**
   The exchange rates are fed back as a design target while deductions are
   enabled. The result shows final bills, resource usage, facility mix, and
   lost production.

This is why detail rows can show:

- `Design`: exchange-only output;
- `Deduct`: direct battery/equipment deduction;
- `Adjust`: solver reallocation after deductions;
- `Final`: remaining exchange output;
- `Bill`: final bill contribution.

## Nearby Generation

Nearby generation starts from the exchange-only low-power baseline.

It currently creates variants from two families.

### Fixed Rate Variants

For visible trade items, the generator tries simple rounded rates near the
baseline. These are bounded by `maxItems`, `maxPerItem`, `granularities`, and
`maxDistance`.

This is useful for small manual slider-style adjustments.

### Fixed Facility Count Variants

The generator inspects final recipes that produce trade items and converts
facility counts back into target rates.

It tries:

- integer final-recipe facility counts for top bill contributors;
- combinations where several top items remain at practical counts;
- relaxed combinations where one top item can move freely;
- lowered integer-ish counts for already large integer-heavy plans;
- low-count snap points for items whose final recipe count is near or below
  `1u`.

The current low-count snap points are deliberately narrow:

- `1/2u`
- `1u`

This avoids flooding the table with many similarly awkward small-fraction rows.

## Splitter Buildability

Buildability is not a hard LP constraint. It is diagnostic metadata used to
prefer useful nearby rows and to explain the chosen row.

The splitter guide is based on exchange-design rates, not deduction-aware final
rates. That is intentional: it describes how to build the intended plan.

Current splitter diagnostics include:

- parent trade item rows;
- one-level child rows;
- final-recipe facility count;
- splitter expression;
- split/merge estimate;
- numeric error.

The guide focuses on parent and direct-child materials. It does not attempt to
fully explain every deeper recipe path.

## Dedupe

The engine can solve more candidates than it displays. Rows are deduplicated
after solving.

Display identity currently includes:

- transfer boost;
- visible trade item design/final rates;
- constrained raw resource usage.

Values are rounded to display-like precision before building the identity key.
This removes rows that are different internally but indistinguishable to users.

Selected rows are kept over duplicates from other policies.

## Ranking

Rows are sorted mainly by deduction-aware bills per hour.

Near ties prefer:

1. better buildability score;
2. lower total facility use;
3. stable ID ordering.

The buildability tie-break is intentionally only a near-tie rule. It should not
make a clearly worse bill result look better than a materially stronger plan.

## UI Update Rules

The candidate table should refresh when any of these change:

- Production target rate or pin state;
- raw resource limit;
- facility limit or integer-only flag;
- selected transfer boost;
- deduction rate;
- recipe availability switch.

Double-clicking a candidate applies its design rates back to Production. The
detail panel closes after applying, so the app does not immediately re-open a
different row after the automatic refresh.

## Guardrails

When changing candidate generation:

- keep exchange design and deduction evaluation separate;
- keep nearby search bounded and observable;
- avoid adding a visible policy when a nearby variant can cover the use case;
- preserve selected rows during dedupe;
- update tests when changing identity, ranking, or nearby target generation.

Useful tests:

- `test/candidate-engine.test.js`
- `test/candidate-neighborhood.test.js`
- `test/candidate-buildability.test.js`
- `test/candidate-apply.test.js`
- `test/solution-summary.test.js`
