/*
 * Solver kernel boundary.
 *
 * This layer is intentionally lower than WulingSolverService and higher than
 * solver_pipeline.js.  It does not know about the UI; callers provide a
 * snapshot and receive a normalized result envelope.
 */
(function (global) {
  function defaultPipeline() {
    return global.WulingSolverPipeline ?? null;
  }

  function normalizeResult(result, meta = {}) {
    const status = result?.status ?? "missing";
    const ok = status === "optimal";
    return {
      ok,
      status,
      meta,
      netRates: result?.netRates ?? {},
      rawUse: result?.rawUse ?? {},
      facUse: result?.facUse ?? {},
      recipeFacilityCounts: result?.recipeFacilityCounts ?? {},
      graphRecipeCount: result?.graphRecipeCount ?? 0,
      graphItemCount: result?.graphItemCount ?? 0,
      timings: result?.timings ?? {},
      raw: result ?? null,
    };
  }

  function solveSnapshot(snapshot, options = {}) {
    const pipeline = options.pipeline ?? defaultPipeline();
    if (!pipeline || typeof pipeline.solveProductionModel !== "function") {
      return normalizeResult({ status: "unavailable", reason: "solver-pipeline-not-ready" }, {
        phase: options.phase ?? "",
        policyId: options.policy?.id ?? "",
      });
    }
    const result = pipeline.solveProductionModel({
      ...options,
      context: snapshot,
    });
    return normalizeResult(result, {
      phase: options.phase ?? "",
      policyId: options.policy?.id ?? "",
      pinAll: !!options.pinAll,
    });
  }

  function unwrapResult(result) {
    return result?.raw ?? result;
  }

  global.WulingSolverKernel = {
    normalizeResult,
    solveSnapshot,
    unwrapResult,
  };
})(globalThis);
