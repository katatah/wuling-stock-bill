import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/snapshot.js");
await import("../src/scenario/deductions.js");

const scenario = globalThis.WULING_STOCK_BILL_SCENARIO;

test("deductions normalize legacy powerBatteries into Wuling deductions", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot({
    powerBatteries: [
      { matId: "item_proc_battery_5", rate: 3 },
      { matId: "item_liquid_water", rate: 10 },
    ],
  });

  assert.deepEqual(globalThis.WulingDeductions.normalizeDeductions(snapshot, scenario), [
    { itemId: "item_proc_battery_5", rate: 3, source: "legacy-power-batteries" },
  ]);
});

test("solver snapshots can include or exclude Wuling deductions", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot({
    powerBatteries: [
      { matId: "item_proc_battery_5", rate: 3 },
      { matId: "item_liquid_water", rate: 10 },
    ],
  });

  assert.deepEqual(globalThis.WulingDeductions.solverSnapshot(snapshot, scenario, { includeDeductions: false }).powerBatteries, [
    { matId: "item_liquid_water", rate: 10 },
  ]);
  assert.deepEqual(globalThis.WulingDeductions.solverSnapshot(snapshot, scenario, { includeDeductions: true }).powerBatteries, [
    { matId: "item_liquid_water", rate: 10 },
    { matId: "item_proc_battery_5", rate: 3 },
  ]);
});
