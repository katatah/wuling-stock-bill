/*
 * Solver service boundary.
 *
 * The original app solves directly from mutable UI globals.  Wuling candidate
 * generation needs a narrower API so policies can ask for "the current solve"
 * first, and later for "this scenario snapshot solve" without knowing about
 * the side-pane implementation.
 */
(function () {
  function appState() {
    return globalThis.WulingAppState ?? null;
  }

  function getCurrentSnapshot() {
    return appState()?.getSnapshot?.() ?? null;
  }

  function getScenario() {
    return appState()?.getScenario?.() ?? globalThis.WULING_STOCK_BILL_SCENARIO ?? null;
  }

  function solveCurrent(options = {}) {
    const solve = appState()?.solveModel ?? appState()?.solveCurrent;
    if (typeof solve !== "function") {
      return { status: "unavailable", reason: "app-state-not-ready" };
    }
    return solve(options);
  }

  function solveSnapshot(snapshot, options = {}) {
    if (globalThis.WulingSolverKernel?.solveSnapshot) {
      return globalThis.WulingSolverKernel.unwrapResult(
        globalThis.WulingSolverKernel.solveSnapshot(snapshot, options),
      );
    }
    const solve = appState()?.solveSnapshot;
    if (typeof solve !== "function") return { status: "unavailable", reason: "snapshot-solver-not-ready" };
    return solve(snapshot, options);
  }

  globalThis.WulingSolverService = {
    getCurrentSnapshot,
    getScenario,
    solveCurrent,
    solveSnapshot,
  };
})();
