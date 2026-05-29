import test from "node:test";
import assert from "node:assert/strict";

await import("../src/ui/candidate-controller.js");

test("candidate controller solves current snapshot and renders results", () => {
  const rendered = [];
  const candidates = [{ id: "candidate-a" }];
  globalThis.document = {
    getElementById: (id) => ({ id, innerHTML: "" }),
  };
  globalThis.WulingCandidateView = {
    render: (container, rows, state) => rendered.push({ container, rows, state }),
  };
  globalThis.WulingSolverService = {
    getScenario: () => ({ id: "scenario" }),
    getCurrentSnapshot: () => ({ production: [] }),
    solveSnapshot: () => ({ status: "optimal" }),
  };
  globalThis.WulingCandidateEngine = {
    solveCombinedCandidateSet: (_snapshot, _scenario, options) => {
      assert.equal(typeof options.solveSnapshot, "function");
      return candidates;
    },
  };

  const result = globalThis.WulingCandidateController.generate();

  assert.equal(result, candidates);
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].state.busy, true);
  assert.equal(rendered[1].rows, candidates);
  assert.equal(typeof rendered[1].state.elapsedMs, "number");
});

test("candidate controller skips generation when the snapshot is unchanged", () => {
  let calls = 0;
  const snapshot = { production: [{ id: "a", rate: 1 }] };
  globalThis.document = {
    getElementById: (id) => ({ id, innerHTML: "" }),
  };
  globalThis.WulingCandidateView = {
    render: () => {},
  };
  globalThis.WulingSolverService = {
    getScenario: () => ({ id: "scenario" }),
    getCurrentSnapshot: () => snapshot,
    solveSnapshot: () => ({ status: "optimal" }),
  };
  globalThis.WulingCandidateEngine = {
    solveCombinedCandidateSet: () => {
      calls += 1;
      return [{ id: "candidate-a" }];
    },
  };

  globalThis.WulingCandidateController.clear();
  globalThis.WulingCandidateController.generate();
  globalThis.WulingCandidateController.generate();

  assert.equal(calls, 1);
});

test("candidate controller does not select deduction-failed candidates", () => {
  const rendered = [];
  const detailed = [];
  const candidates = [
    { id: "bad", exchangeResult: { status: "optimal" }, deductionResult: { status: "infeasible" } },
    { id: "good", exchangeResult: { status: "optimal" }, deductionResult: { status: "optimal" } },
  ];
  globalThis.document = {
    getElementById: (id) => ({ id, innerHTML: "" }),
  };
  globalThis.WulingCandidateView = {
    render: (container, rows, state) => rendered.push({ container, rows, state }),
  };
  globalThis.WulingDetailView = {
    render: (_container, candidate) => detailed.push(candidate?.id ?? null),
  };
  globalThis.WulingSolverService = {
    getScenario: () => ({ id: "scenario" }),
    getCurrentSnapshot: () => ({ production: [{ id: "item-a", rate: 1 }] }),
    solveSnapshot: () => ({ status: "optimal" }),
  };
  globalThis.WulingCandidateEngine = {
    solveCombinedCandidateSet: () => candidates,
    orderCandidateResults: (rows) => rows.filter((candidate) => candidate.deductionResult?.status === "optimal"),
  };

  globalThis.WulingCandidateController.clear();
  globalThis.WulingCandidateController.generate();

  assert.equal(globalThis.WulingCandidateController.selectedCandidate()?.id, "good");
  assert.equal(rendered.at(-1).state.selectedId, "good");
  assert.equal(detailed.at(-1), "good");
});

test("candidate controller auto-selects the selected policy after regeneration", () => {
  const rendered = [];
  const candidates = [
    { id: "power", policy: { id: "power" }, exchangeResult: { status: "optimal" }, deductionResult: { status: "optimal" } },
    { id: "selected", policy: { id: "selected" }, exchangeResult: { status: "optimal" }, deductionResult: { status: "optimal" } },
  ];
  let snapshotRate = 1;
  globalThis.document = {
    getElementById: (id) => ({ id, innerHTML: "" }),
  };
  globalThis.WulingCandidateView = {
    render: (_container, _rows, state) => rendered.push(state),
  };
  globalThis.WulingDetailView = {
    render: () => {},
  };
  globalThis.WulingSolverService = {
    getScenario: () => ({ id: "scenario" }),
    getCurrentSnapshot: () => ({ production: [{ id: "item-a", rate: snapshotRate }] }),
    solveSnapshot: () => ({ status: "optimal" }),
  };
  globalThis.WulingCandidateEngine = {
    solveCombinedCandidateSet: () => candidates,
    orderCandidateResults: (rows) => rows,
  };

  globalThis.WulingCandidateController.clear();
  globalThis.WulingCandidateController.generate();
  globalThis.WulingCandidateController.select("power");
  snapshotRate = 2;
  globalThis.WulingCandidateController.generate();

  assert.equal(globalThis.WulingCandidateController.selectedCandidate()?.id, "selected");
  assert.equal(rendered.at(-1).selectedId, "selected");
});
