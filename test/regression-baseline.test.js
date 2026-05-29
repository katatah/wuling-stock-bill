import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/snapshot.js");
await import("../src/scenario/candidate-policies.js");
await import("../src/scenario/deductions.js");
await import("../src/scenario/candidate-engine.js");

const scenario = globalThis.WULING_STOCK_BILL_SCENARIO;

function billPerMinuteFromDefaultState() {
  const prices = Object.fromEntries(scenario.tradeItems.map((entry) => [entry.itemId, entry.price]));
  return scenario.defaultState.production.reduce((sum, entry) => {
    return sum + (Number(entry.rate) || 0) * (prices[entry.id] ?? 0);
  }, 0);
}

test("baseline Wuling scenario keeps current event caps and target value", () => {
  assert.equal(scenario.maxBillsPerHour, 59688);
  assert.deepEqual(
    scenario.constrainedResources.map((entry) => [entry.itemId, entry.defaultCap]),
    [
      ["item_originium_ore", 540],
      ["item_iron_ore", 90],
      ["item_copper_ore", 240],
    ],
  );
  assert.deepEqual(scenario.constrainedFacilities, [
    { facilityId: "xiranite_oven_1", defaultCap: 12, integerOnly: false },
  ]);
});

test("baseline Wuling default gross design bill value is stable", () => {
  assert.equal(Number(billPerMinuteFromDefaultState().toFixed(2)), 1423.69);
  assert.equal(Number((billPerMinuteFromDefaultState() * 60).toFixed(0)), 85421);
});

test("baseline candidate request matrix stays small and explicit", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const requests = globalThis.WulingCandidateEngine.buildCandidateRequests(snapshot, scenario);

  assert.deepEqual(requests.map((request) => request.id), [
    "power|resource-boost:item_originium_ore:50",
    "power|resource-boost:item_iron_ore:25",
  ]);
});

test("baseline solver weights remain deliberate tie-breakers", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync("assets/solver_config.js", "utf8"), context);

  assert.deepEqual(JSON.parse(JSON.stringify(context.window.SOLVER_CONFIG.weights)), {
    surplus: 0.05,
    machine: 0.001,
    power: 0.00005,
    target: 0.1,
  });
});
