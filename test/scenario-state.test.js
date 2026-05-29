import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/state.js");

const recipesSource = JSON.parse(readFileSync("assets/recipes.json", "utf8"));
const recipesByOutput = {};
for (const recipe of recipesSource.recipes) {
  for (const output of recipe.outputs ?? []) {
    recipesByOutput[output.itemId] ??= [];
    recipesByOutput[output.itemId].push(recipe);
  }
}
const facilityById = Object.fromEntries(recipesSource.facilities.map((facility) => [facility.id, facility]));

test("scenario prices are derived from trade item values", () => {
  const prices = globalThis.WulingScenarioState.scenarioPrices(globalThis.WULING_STOCK_BILL_SCENARIO);

  assert.equal(prices.item_proc_battery_5, 54);
  assert.equal(prices.item_xiranite_powder, 1);
});

test("scenario default state can be built through the scenario state helper", () => {
  const state = globalThis.WulingScenarioState.buildScenarioDefaultState(globalThis.WULING_STOCK_BILL_SCENARIO, {
    recipesByOutput,
    facilityById,
  });

  assert.equal(state.rawLimits.find((entry) => entry.matId === "item_originium_ore")?.cap, 540);
  assert.equal(state.facilityLimits[0].gameFacilityId, "xiranite_oven_1");
  assert.equal(state.powerBatteries.find((entry) => entry.matId === "item_proc_battery_5")?.rate, 3);
  assert.equal(state.production.some((entry) => entry.id === "item_proc_battery_5"), true);
});

