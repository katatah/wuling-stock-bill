import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
globalThis.performance = { now: () => 0 };

await import("../src/solver_pipeline.js");

test("solver pipeline exposes a UI-independent boundary", () => {
  assert.equal(typeof globalThis.WulingSolverPipeline.solveProductionModel, "function");
  assert.equal(typeof globalThis.WulingSolverPipeline.compileLP, "function");
  assert.equal(typeof globalThis.WulingSolverPipeline.computeNetRatesFromFlow, "function");
});

test("solver pipeline can format an LP model without DOM globals", () => {
  const lp = globalThis.WulingSolverPipeline.compileLP({
    optimize: "profit",
    opType: "max",
    constraints: {
      cap: { max: 10 },
    },
    variables: {
      x_0: { profit: 2, cap: 1 },
      x_1: { profit: -1, cap: 0.5 },
    },
  });

  assert.match(lp, /Maximize/);
  assert.match(lp, /obj: 2 x_0 - 1 x_1/);
  assert.match(lp, /cap: 1 x_0 \+ 0.5 x_1 <= 10/);
});

test("solver pipeline can format narrow two-sided bounds", () => {
  const lp = globalThis.WulingSolverPipeline.compileLP({
    optimize: "profit",
    opType: "min",
    constraints: {
      pinned: { min: 9.9999, max: 10.0001 },
    },
    variables: {
      x_0: { profit: 1, pinned: 1 },
    },
  });

  assert.match(lp, /pinned_max: 1 x_0 <= 10.0001/);
  assert.match(lp, /pinned_min: 1 x_0 >= 9.9999/);
});

test("solver pipeline returns pending instead of touching UI when HiGHS is absent", () => {
  const result = globalThis.WulingSolverPipeline.solveProductionModel({
    context: {
      production: [{ id: "demo", rate: 1 }],
      rawLimits: [],
      facilityLimits: [],
      prices: {},
    },
  });

  assert.equal(result.status, "pending");
});
