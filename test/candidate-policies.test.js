import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/candidate-policies.js");

test("user-facing Wuling candidate policies stay small", () => {
  const policies = globalThis.WulingCandidatePolicies.candidatePoliciesForScenario(globalThis.WULING_STOCK_BILL_SCENARIO);

  assert.deepEqual(policies.map((policy) => policy.id), ["power"]);
});

test("hidden candidate policies are available for internal baselines", () => {
  const policies = globalThis.WulingCandidatePolicies.candidatePoliciesForScenario(
    globalThis.WULING_STOCK_BILL_SCENARIO,
    { includeHidden: true },
  );

  assert.equal(policies.some((policy) => policy.id === "raw-max" && policy.hidden), true);
  assert.equal(policies.some((policy) => policy.id === "practical-integer" && policy.hidden), true);
  assert.equal(policies.every((policy) => policy.sequence.length > 0), true);
});
