import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/snapshot.js");
await import("../src/scenario/candidate-engine.js");
await import("../src/scenario/candidate-neighborhood.js");

const scenario = globalThis.WULING_STOCK_BILL_SCENARIO;

test("nearby rounded values prefer close build-friendly targets", () => {
  assert.deepEqual(
    globalThis.WulingCandidateNeighborhood.roundedValuesNear(13.5, { granularities: [1, 0.5] }),
    [14, 13],
  );
  assert.deepEqual(
    globalThis.WulingCandidateNeighborhood.roundedValuesNear(12.97, { granularities: [1, 0.5] }).slice(0, 2),
    [13, 12.5],
  );
});

test("nearby variants lock one trade item around the baseline result", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const variants = globalThis.WulingCandidateNeighborhood.buildNearbyRateVariants(
    snapshot,
    {
      netRates: {
        item_proc_battery_5: 13.5,
        item_copper_enr_cmpt: 3.25,
        item_xiranite_powder: 22.76,
      },
    },
    scenario,
    { maxItems: 2, maxPerItem: 1, granularities: [1] },
  );

  assert.deepEqual(variants.map((variant) => variant.itemId), [
    "item_proc_battery_5",
    "item_copper_enr_cmpt",
  ]);
  assert.equal(variants[0].targetRate, 14);
  assert.equal(
    variants[0].snapshot.production.find((entry) => entry.id === "item_proc_battery_5").locked,
    true,
  );
  assert.equal(
    snapshot.production.find((entry) => entry.id === "item_proc_battery_5").locked,
    false,
  );
});

test("nearby variants can lock top two final recipes to integer facility counts", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  globalThis.RECIPES_DB = {
    recipes: [
      {
        id: "recipe_a",
        craftingTime: 10,
        outputs: [{ itemId: "item_proc_battery_5", amount: 1 }],
      },
      {
        id: "recipe_b",
        craftingTime: 10,
        outputs: [{ itemId: "item_copper_enr_cmpt", amount: 1 }],
      },
    ],
  };
  const variants = globalThis.WulingCandidateNeighborhood.buildIntegerFacilityComboVariants(
    snapshot,
    {
      recipeFacilityCounts: {
        recipe_a: 13.5,
        recipe_b: 4.25,
      },
    },
    scenario,
    { topCount: 2, maxCombos: 1 },
  );

  assert.equal(variants.length, 1);
  assert.deepEqual(
    variants[0].fixedRates.map((entry) => [entry.itemId, entry.targetFacilityCount, entry.targetRate]),
    [
      ["item_proc_battery_5", 14, 84],
      ["item_copper_enr_cmpt", 4, 24],
    ],
  );
  assert.equal(variants[0].snapshot.production.find((entry) => entry.id === "item_proc_battery_5").rate, 84);
  assert.equal(variants[0].snapshot.production.find((entry) => entry.id === "item_copper_enr_cmpt").rate, 24);
});

test("nearby integer variants can relax or lower one of several already-integer outputs", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  globalThis.RECIPES_DB = {
    recipes: [
      {
        id: "recipe_a",
        craftingTime: 10,
        outputs: [{ itemId: "item_proc_battery_5", amount: 1 }],
      },
      {
        id: "recipe_b",
        craftingTime: 10,
        outputs: [{ itemId: "item_copper_enr_cmpt", amount: 1 }],
      },
      {
        id: "recipe_c",
        craftingTime: 10,
        outputs: [{ itemId: "item_xiranite_enr_powder", amount: 1 }],
      },
    ],
  };
  const variants = globalThis.WulingCandidateNeighborhood.buildIntegerFacilityComboVariants(
    snapshot,
    {
      recipeFacilityCounts: {
        recipe_a: 12,
        recipe_b: 6,
        recipe_c: 4,
      },
    },
    scenario,
    { topCount: 3, maxCombos: 8 },
  );

  assert.equal(variants.length, 8);
  assert.equal(variants.some((variant) => variant.id.startsWith("nearby-facility-relax-")), true);
  assert.equal(variants.some((variant) => variant.id.startsWith("nearby-facility-lower-")), true);
  assert.equal(variants.some((variant) => variant.fixedRates.length === 2), true);
  assert.equal(
    variants.some((variant) => variant.fixedRates.some((entry) => entry.targetFacilityCount < entry.sourceFacilityCount)),
    true,
  );
});

test("nearby low facility targets snap small outputs to simple half or full units", () => {
  const targets = globalThis.WulingCandidateNeighborhood.lowFacilitySnapTargets({
    facilityCount: 0.62,
    ratePerFacility: 6,
  });

  assert.deepEqual(
    targets.map((entry) => [entry.facilityCount, entry.targetRate]),
    [
      [0.5, 3],
      [1, 6],
    ],
  );
});

test("nearby low facility variants can inspect beyond the top integer rows", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  globalThis.RECIPES_DB = {
    recipes: [
      { id: "recipe_a", craftingTime: 10, outputs: [{ itemId: "item_proc_battery_5", amount: 1 }] },
      { id: "recipe_b", craftingTime: 10, outputs: [{ itemId: "item_copper_enr_cmpt", amount: 1 }] },
      { id: "recipe_c", craftingTime: 10, outputs: [{ itemId: "item_xiranite_enr_powder", amount: 1 }] },
      { id: "recipe_d", craftingTime: 10, outputs: [{ itemId: "item_bottled_rec_hp_5", amount: 1 }] },
    ],
  };
  const variants = globalThis.WulingCandidateNeighborhood.buildIntegerFacilityComboVariants(
    snapshot,
    {
      recipeFacilityCounts: {
        recipe_a: 12,
        recipe_b: 6,
        recipe_c: 4,
        recipe_d: 0.6,
      },
    },
    scenario,
    { topCount: 3, lowFacilityTopCount: 4, lowSnapMaxCombos: 6 },
  );

  assert.equal(
    variants.some((variant) => variant.id.includes("item_bottled_rec_hp_5:0.5")),
    true,
  );
});
