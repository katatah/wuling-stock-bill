import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/candidate-apply.js");

test("candidate apply plan copies gross design rates and selected boost", () => {
  const candidate = {
    variant: { boost: { itemId: "item_originium_ore", amount: 50 } },
    summary: {
      billComposition: [
        { itemId: "item_sc_wuling_battery", designRate: 12, finalRate: 9 },
        { itemId: "item_hetonite_part", designRate: 0, finalRate: 0 },
        { itemId: "item_heavy_xiranite", designRate: 10.5, finalRate: 9.2 },
      ],
    },
  };

  const plan = globalThis.WulingCandidateApply.candidateApplyPlan(candidate);

  assert.deepEqual(plan, {
    selectedResourceBoostId: "resource-boost:item_originium_ore:50",
    production: [
      { itemId: "item_sc_wuling_battery", rate: 12, locked: false, optimized: false },
      { itemId: "item_heavy_xiranite", rate: 10.5, locked: false, optimized: false },
    ],
  });
});

