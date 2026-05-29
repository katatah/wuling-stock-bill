import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/snapshot.js");
await import("../src/scenario/deductions.js");
await import("../src/scenario/solution-summary.js");

const scenario = globalThis.WULING_STOCK_BILL_SCENARIO;

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ~= ${expected}`);
}

test("solution summary separates design, direct deduction, adjustment, and final rates", () => {
  const candidate = {
    id: "demo",
    policy: { id: "power" },
    variant: { id: "resource-boost:item_originium_ore:50" },
    deductionSnapshot: globalThis.WulingStateSnapshot.createStateSnapshot({
      powerBatteries: [{ matId: "item_proc_battery_5", rate: 3 }],
    }),
    exchangeResult: {
      status: "optimal",
      netRates: { item_proc_battery_5: 12 },
    },
    deductionResult: {
      status: "optimal",
      netRates: { item_proc_battery_5: 11 },
      rawUse: { item_originium_ore: 540 },
      facUse: { xiranite_oven_1: 12 },
    },
  };

  const summary = globalThis.WulingSolutionSummary.summarizeCandidate(candidate, scenario);
  const row = summary.billComposition.find((entry) => entry.itemId === "item_proc_battery_5");

  assert.equal(summary.exchangeBillsPerHour, 12 * 54 * 60);
  assert.equal(summary.deductionBillsPerHour, 8 * 54 * 60);
  assert.equal(row.designRate, 12);
  assert.equal(row.directDeductionRate, 3);
  assert.equal(row.finalGrossRate, 11);
  assert.equal(row.solverAdjustmentRate, -1);
  assert.equal(row.finalRate, 8);
});

test("solution summary subtracts direct deductions from gross deduction solve rates", () => {
  const candidate = {
    id: "demo-direct-only",
    deductionSnapshot: globalThis.WulingStateSnapshot.createStateSnapshot({
      powerBatteries: [{ matId: "item_proc_battery_5", rate: 3 }],
    }),
    exchangeResult: {
      status: "optimal",
      netRates: { item_proc_battery_5: 12 },
    },
    deductionResult: {
      status: "optimal",
      netRates: { item_proc_battery_5: 12 },
    },
  };

  const summary = globalThis.WulingSolutionSummary.summarizeCandidate(candidate, scenario);
  const row = summary.billComposition.find((entry) => entry.itemId === "item_proc_battery_5");

  assert.equal(row.designRate, 12);
  assert.equal(row.directDeductionRate, 3);
  assert.equal(row.finalGrossRate, 12);
  assert.equal(row.solverAdjustmentRate, 0);
  assert.equal(row.finalRate, 9);
  assert.equal(summary.deductionBillsPerHour, 9 * 54 * 60);
});

test("solution summary classifies one-step equipment inputs as deduction impact", () => {
  globalThis.RECIPES_DB = {
    recipes: [{
      id: "make_equipment",
      inputs: [{ itemId: "item_copper_enr_cmpt", amount: 2 }],
      outputs: [{ itemId: "item_equip_script_4_2", amount: 1 }],
    }],
  };
  const candidate = {
    id: "demo-equipment-input",
    deductionSnapshot: globalThis.WulingStateSnapshot.createStateSnapshot({
      powerBatteries: [{ matId: "item_equip_script_4_2", rate: 0.7 }],
    }),
    exchangeResult: {
      status: "optimal",
      netRates: { item_copper_enr_cmpt: 6 },
    },
    deductionResult: {
      status: "optimal",
      netRates: { item_copper_enr_cmpt: 4.6 },
    },
  };

  const summary = globalThis.WulingSolutionSummary.summarizeCandidate(candidate, scenario);
  const row = summary.billComposition.find((entry) => entry.itemId === "item_copper_enr_cmpt");

  assert.equal(row.designRate, 6);
  assert.equal(row.directDeductionRate, 1.4);
  assert.equal(row.finalGrossRate, 4.6);
  assert.equal(row.solverAdjustmentRate, 0);
  assert.equal(row.finalRate, 4.6);
});

test("solution summary keeps equipment input deduction visible when the solver compensates", () => {
  globalThis.RECIPES_DB = {
    recipes: [{
      id: "make_hetonite_component",
      inputs: [
        { itemId: "item_copper_enr_cmpt", amount: 2 },
        { itemId: "item_xiranite_enr_powder", amount: 2 },
      ],
      outputs: [{ itemId: "item_equip_script_4_2", amount: 1 }],
    }],
  };
  const candidate = {
    id: "demo-compensated-equipment-input",
    deductionSnapshot: globalThis.WulingStateSnapshot.createStateSnapshot({
      powerBatteries: [{ matId: "item_equip_script_4_2", rate: 0.7 }],
    }),
    exchangeResult: {
      status: "optimal",
      netRates: { item_xiranite_enr_powder: 12 },
    },
    deductionResult: {
      status: "optimal",
      netRates: { item_xiranite_enr_powder: 12 },
    },
  };

  const summary = globalThis.WulingSolutionSummary.summarizeCandidate(candidate, scenario);
  const row = summary.billComposition.find((entry) => entry.itemId === "item_xiranite_enr_powder");

  assert.equal(row.designRate, 12);
  assertClose(row.directDeductionRate, 1.4);
  assert.equal(row.finalGrossRate, 12);
  assertClose(row.solverAdjustmentRate, 1.4);
  assert.equal(row.finalRate, 12);
});

test("solution summary reports equivalent-only deduction rows as compensating adjustment", () => {
  globalThis.RECIPES_DB = {
    recipes: [{
      id: "make_hetonite_component",
      inputs: [
        { itemId: "item_copper_enr_cmpt", amount: 2 },
        { itemId: "item_xiranite_enr_powder", amount: 2 },
      ],
      outputs: [{ itemId: "item_equip_script_4_2", amount: 1 }],
    }],
  };
  const candidate = {
    id: "demo-equivalent-only-equipment-input",
    deductionSnapshot: globalThis.WulingStateSnapshot.createStateSnapshot({
      powerBatteries: [{ matId: "item_equip_script_4_2", rate: 0.7 }],
    }),
    exchangeResult: {
      status: "optimal",
      netRates: { item_proc_battery_5: 12 },
    },
    deductionResult: {
      status: "optimal",
      netRates: { item_proc_battery_5: 9 },
    },
  };

  const summary = globalThis.WulingSolutionSummary.summarizeCandidate(candidate, scenario);
  const copperRow = summary.billComposition.find((entry) => entry.itemId === "item_copper_enr_cmpt");
  const xiraniteRow = summary.billComposition.find((entry) => entry.itemId === "item_xiranite_enr_powder");

  assert.equal(copperRow.designRate, 0);
  assert.equal(copperRow.directDeductionRate, 1.4);
  assert.equal(copperRow.finalRate, 0);
  assertClose(copperRow.solverAdjustmentRate, 1.4);
  assert.equal(xiraniteRow.designRate, 0);
  assert.equal(xiraniteRow.directDeductionRate, 1.4);
  assert.equal(xiraniteRow.finalRate, 0);
  assertClose(xiraniteRow.solverAdjustmentRate, 1.4);
  assert.equal(summary.billComposition.some((entry) => entry.itemId === "item_proc_battery_5"), true);
});
