import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/candidate-engine.js");
await import("../src/ui/candidate.js");

test("candidate view renders an empty state without candidates", () => {
  const container = { innerHTML: "" };

  globalThis.WulingCandidateView.render(container, []);

  assert.match(container.innerHTML, /Candidates/);
  assert.match(container.innerHTML, /not generated/);
});

test("candidate view renders candidate rows", () => {
  const container = { innerHTML: "" };
  globalThis.WULING_STOCK_BILL_SCENARIO = {
    tradeItems: [{ itemId: "item_proc_battery_5", price: 54, defaultTarget: true }],
    constrainedResources: [],
  };

  globalThis.WulingCandidateView.render(container, [
    {
      id: "demo",
      policy: { id: "power", label: "Power" },
      variant: { id: "boost", label: "+50" },
      variantLabel: "+50",
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 1234,
        exchangeBillsPerHour: 1300,
        gapToMaxBillsPerHour: -10,
        totalFacilityUse: 3.5,
        billComposition: [{ itemId: "item_proc_battery_5", designRate: 3, finalRate: 1 }],
      },
    },
  ]);

  assert.match(container.innerHTML, /1,234/);
  assert.match(container.innerHTML, /After deductions/);
  assert.match(container.innerHTML, /-2/);
  assert.match(container.innerHTML, /Bills/);
  assert.match(container.innerHTML, /Transfer/);
  assert.match(container.innerHTML, /WulingCandidateController\?\.select/);
});

test("candidate view renders metastorage transfer boost", () => {
  const container = { innerHTML: "" };
  globalThis.ITEMS_DB = [
    { id: "item_originium_ore", name: "Originium Ore", iconFile: "originium.webp" },
  ];

  globalThis.WulingCandidateView.render(container, [
    {
      id: "demo",
      variant: { id: "resource-boost:item_originium_ore:50", label: "+50", boost: { itemId: "item_originium_ore", amount: 50 } },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 1234,
        billComposition: [],
      },
    },
  ]);

  assert.match(container.innerHTML, /Metastorage Transfer/);
  assert.match(container.innerHTML, /Originium Ore/);
  assert.match(container.innerHTML, /\+50/);
});

test("candidate view marks the selected row", () => {
  const container = { innerHTML: "" };

  globalThis.WulingCandidateView.render(container, [
    {
      id: "demo",
      policy: { id: "power", label: "Power" },
      variant: { id: "boost", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 1234,
        totalFacilityUse: 3.5,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
  ], { selectedId: "demo" });

  assert.match(container.innerHTML, /is-selected/);
  assert.match(container.innerHTML, /aria-pressed="true"/);
});

test("candidate view marks the current production selection candidate", () => {
  const container = { innerHTML: "" };

  globalThis.WulingCandidateView.render(container, [
    {
      id: "selected-demo",
      policy: { id: "selected", label: "Selected" },
      variant: { id: "boost", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 1234,
        totalFacilityUse: 3.5,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
  ]);

  assert.match(container.innerHTML, /candidate-production-mark/);
  assert.match(container.innerHTML, /◆/);
});

test("candidate view hides equivalent rows", () => {
  const container = { innerHTML: "" };
  const candidate = (id) => ({
    id,
    variant: { id: "same-boost", label: "+50" },
    exchangeResult: { status: "optimal" },
    deductionResult: { status: "optimal" },
    summary: {
      deductionBillsPerHour: 1234,
      totalFacilityUse: 3.5,
      billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
    },
  });

  globalThis.WulingCandidateView.render(container, [candidate("same-a"), candidate("same-b")]);

  assert.match(container.innerHTML, /same-a/);
  assert.doesNotMatch(container.innerHTML, /same-b/);
});
