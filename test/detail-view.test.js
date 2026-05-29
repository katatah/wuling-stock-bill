import test from "node:test";
import assert from "node:assert/strict";

await import("../src/ui/detail-helpers.js");
await import("../src/ui/detail-export.js");
await import("../src/ui/detail.js");

test("detail view renders selected candidate summaries", () => {
  const container = { innerHTML: "" };
  globalThis.ITEMS_DB = [
    { id: "item_proc_battery_5", name: "SC Wuling Battery", iconFile: "battery.webp" },
    { id: "item_originium_ore", name: "Originium Ore", iconFile: "originium.webp" },
    { id: "item_demo_output", name: "Demo Output", iconFile: "demo.webp" },
    { id: "item_demo_output_b", name: "Demo Output B", iconFile: "demo-b.webp" },
    { id: "item_liquid_sewage", name: "Sewage", iconFile: "sewage.webp" },
  ];
  globalThis.RECIPES_DB = {
    facilities: [{ id: "fac_crucible", name: "Demo Crucible" }],
    recipes: [
      {
        id: "recipe_demo",
        facilityId: "fac_crucible",
        craftingTime: 2,
        inputs: [{ itemId: "item_liquid_sewage", amount: 1 }],
        outputs: [{ itemId: "item_demo_output", amount: 1 }],
      },
      {
        id: "recipe_demo_b",
        facilityId: "fac_crucible",
        craftingTime: 2,
        inputs: [{ itemId: "item_liquid_sewage", amount: 2 }],
        outputs: [{ itemId: "item_demo_output_b", amount: 1 }],
      },
    ],
  };
  globalThis.WULING_STOCK_BILL_SCENARIO = {
    tradeItems: [
      { itemId: "item_proc_battery_5", price: 54 },
      { itemId: "item_demo_output", price: 10 },
    ],
    deductions: [
      { itemId: "item_proc_battery_5" },
      { itemId: "item_equip_script_4" },
    ],
  };
  globalThis.WulingSolutionSummary = {
    positiveTradeRates: (result) => result?.netRates ?? {},
  };
  globalThis.WulingDeductions = {
    deductionRateMap: () => ({
      item_proc_battery_5: 3,
      item_equip_script_4: 0.7,
    }),
  };

  globalThis.WulingDetailView.render(container, {
    id: "demo",
    policy: { id: "power", label: "Power" },
    variant: { label: "+50" },
    summary: {
      billComposition: [
        {
          itemId: "item_proc_battery_5",
          designRate: 12,
          directDeductionRate: 3,
          solverAdjustmentRate: -1,
          finalRate: 8,
          finalBillsPerHour: 25920,
        },
      ],
      rawUse: { item_originium_ore: 540 },
      facUse: { fac_crucible: 3.5 },
    },
    deductionResult: {
      netRates: {
        item_proc_battery_5: 9,
        item_demo_output: 1,
      },
      recipeFacilityCounts: { recipe_demo: 3.5, recipe_demo_b: 1 },
    },
    exchangeResult: {
      netRates: {
        item_proc_battery_5: 12,
        item_demo_output: 1,
      },
      recipeFacilityCounts: { recipe_demo: 3.5, recipe_demo_b: 1 },
    },
    deductionSnapshot: {
      rawLimits: [{ matId: "item_originium_ore", cap: 540 }],
      facilityLimits: [{ gameFacilityId: "fac_crucible", cap: 5 }],
    },
  });

  assert.match(container.innerHTML, /Bill composition/);
  assert.match(container.innerHTML, /Adjust loss/);
  assert.match(container.innerHTML, /Adjust gain/);
  assert.match(container.innerHTML, /Design/);
  assert.match(container.innerHTML, /Deduct/);
  assert.match(container.innerHTML, /Adjust/);
  assert.match(container.innerHTML, /Final/);
  assert.match(container.innerHTML, /SC Wuling Battery/);
  assert.match(container.innerHTML, /-3.00\/m/);
  assert.match(container.innerHTML, /-1.00\/m/);
  assert.match(container.innerHTML, /25,920\/h/);
  assert.match(container.innerHTML, /Total/);
  assert.match(container.innerHTML, /Open in endfield-calc/);
  assert.match(container.innerHTML, /Resource &amp; Facility Usage/);
  assert.doesNotMatch(container.innerHTML, /Raw resource limits/);
  assert.match(container.innerHTML, /Originium Ore/);
  assert.doesNotMatch(container.innerHTML, /Shared materials/);
  assert.match(container.innerHTML, /Sewage/);
  assert.match(container.innerHTML, /Demo Output B/);
  assert.match(container.innerHTML, /Facilities/);
  assert.match(container.innerHTML, /Demo Crucible/);
  assert.match(container.innerHTML, /3.50u \/ 5u/);
  assert.match(container.innerHTML, /Demo Output/);
  assert.match(container.innerHTML, /105.0\/m/);

  const calcUrl = globalThis.WulingDetailView.endfieldCalcUrl({
    exchangeResult: {
      netRates: {
        item_proc_battery_5: 12,
      },
    },
    deductionSnapshot: {},
  });
  assert.match(calcUrl, /item_proc_battery_5%3A12/);
  assert.match(calcUrl, /item_equip_script_4%3A0.7/);
  assert.doesNotMatch(calcUrl, /item_proc_battery_5%3A15/);
});
