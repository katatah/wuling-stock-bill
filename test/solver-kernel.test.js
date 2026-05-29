import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/solver-kernel.js");

test("solver kernel reports unavailable when the pipeline is absent", () => {
  const previous = globalThis.WulingSolverPipeline;
  delete globalThis.WulingSolverPipeline;

  const result = globalThis.WulingSolverKernel.solveSnapshot({ production: [] });

  assert.equal(result.ok, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.raw.reason, "solver-pipeline-not-ready");
  globalThis.WulingSolverPipeline = previous;
});

test("solver kernel normalizes pipeline solve results", () => {
  const pipeline = {
    solveProductionModel: (options) => {
      assert.equal(options.context.marker, "snapshot");
      assert.equal(options.pinAll, true);
      return {
        status: "optimal",
        netRates: { item_a: 2 },
        rawUse: { raw_a: 4 },
        facUse: { fac_a: 1.5 },
        recipeFacilityCounts: { recipe_a: 1.5 },
        graphRecipeCount: 3,
        graphItemCount: 5,
      };
    },
  };

  const result = globalThis.WulingSolverKernel.solveSnapshot(
    { marker: "snapshot" },
    { pipeline, pinAll: true, phase: "exchange", policy: { id: "power" } },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "optimal");
  assert.deepEqual(result.netRates, { item_a: 2 });
  assert.deepEqual(result.meta, { phase: "exchange", policyId: "power", pinAll: true });
});
