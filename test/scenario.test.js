import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../src/scenario/wuling-stock-bill.js");

const scenario = globalThis.WULING_STOCK_BILL_SCENARIO;
const items = JSON.parse(readFileSync("assets/items.json", "utf8"));
const recipesSource = JSON.parse(readFileSync("assets/recipes.json", "utf8"));
const itemIds = new Set(items.map((item) => item.id));
const facilityIds = new Set(recipesSource.facilities.map((facility) => facility.id));
const recipeIds = new Set(recipesSource.recipes.map((recipe) => recipe.id));

test("Wuling scenario is registered globally", () => {
  assert.equal(scenario.id, "wuling-stock-bill");
  assert.equal(scenario.maxBillsPerHour, 59688);
});

test("Wuling scenario references known catalog entities", () => {
  for (const entry of scenario.tradeItems) {
    assert.equal(itemIds.has(entry.itemId), true, `missing trade item ${entry.itemId}`);
  }
  for (const entry of scenario.constrainedResources) {
    assert.equal(itemIds.has(entry.itemId), true, `missing resource ${entry.itemId}`);
  }
  for (const entry of scenario.constrainedFacilities) {
    assert.equal(facilityIds.has(entry.facilityId), true, `missing facility ${entry.facilityId}`);
  }
  for (const entry of scenario.deductions) {
    assert.equal(itemIds.has(entry.itemId), true, `missing deduction item ${entry.itemId}`);
  }
});

test("Wuling default state references known recipes and entities", () => {
  for (const entry of scenario.defaultState.production) {
    assert.equal(itemIds.has(entry.id), true, `missing production item ${entry.id}`);
    if (entry.recipeId) assert.equal(recipeIds.has(entry.recipeId), true, `missing recipe ${entry.recipeId}`);
  }
  for (const entry of scenario.defaultState.rawLimits) {
    assert.equal(itemIds.has(entry.matId), true, `missing raw limit item ${entry.matId}`);
  }
  for (const entry of scenario.defaultState.facilityLimits) {
    assert.equal(facilityIds.has(entry.gameFacilityId), true, `missing facility limit ${entry.gameFacilityId}`);
  }
  for (const entry of scenario.defaultState.powerBatteries) {
    assert.equal(itemIds.has(entry.matId), true, `missing deduction/power item ${entry.matId}`);
  }
});

