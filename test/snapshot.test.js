import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/snapshot.js");

test("state snapshots clone mutable collections", () => {
  const original = {
    production: [{ id: "item_proc_battery_5", rate: 12 }],
    rawLimits: [{ matId: "item_originium_ore", cap: 540 }],
    facilityLimits: [{ gameFacilityId: "xiranite_oven_1", cap: 12 }],
    powerBatteries: [{ matId: "item_proc_battery_5", rate: 3 }],
    prices: { item_proc_battery_5: 54 },
    recipeOptions: { usePurificationNodeRecipes: false },
    autoSolve: true,
    prioritizeUnsellable: false,
    outpostCost: 59688,
  };

  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(original);
  original.production[0].rate = 1;
  original.prices.item_proc_battery_5 = 1;
  original.recipeOptions.usePurificationNodeRecipes = true;

  assert.equal(snapshot.production[0].rate, 12);
  assert.equal(snapshot.prices.item_proc_battery_5, 54);
  assert.equal(snapshot.recipeOptions.usePurificationNodeRecipes, false);
});

test("exchange-only snapshots remove configured deduction items", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot({
    powerBatteries: [
      { matId: "item_proc_battery_5", rate: 3 },
      { matId: "item_liquid_water", rate: 10 },
    ],
  });

  const exchangeOnly = globalThis.WulingStateSnapshot.exchangeOnlySnapshot(
    snapshot,
    globalThis.WULING_STOCK_BILL_SCENARIO,
  );

  assert.deepEqual(exchangeOnly.powerBatteries, [{ matId: "item_liquid_water", rate: 10 }]);
});
