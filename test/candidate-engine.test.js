import test from "node:test";
import assert from "node:assert/strict";

await import("../src/scenario/wuling-stock-bill.js");
await import("../src/scenario/snapshot.js");
await import("../src/scenario/candidate-policies.js");
await import("../src/scenario/deductions.js");
await import("../src/scenario/candidate-buildability.js");
await import("../src/scenario/candidate-neighborhood.js");
await import("../src/scenario/candidate-engine.js");

const scenario = globalThis.WULING_STOCK_BILL_SCENARIO;

test("resource boost variants clone snapshots and add one boost", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const variants = globalThis.WulingCandidateEngine.resourceBoostVariants(snapshot, scenario);

  assert.deepEqual(variants.map((variant) => variant.id), [
    "resource-boost:item_originium_ore:50",
    "resource-boost:item_iron_ore:25",
  ]);
  assert.equal(variants[0].snapshot.rawLimits.find((entry) => entry.matId === "item_originium_ore").cap, 590);
  assert.equal(snapshot.rawLimits.find((entry) => entry.matId === "item_originium_ore").cap, 540);
});

test("candidate requests combine visible policies and resource boosts", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const requests = globalThis.WulingCandidateEngine.buildCandidateRequests(snapshot, scenario);

  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => request.id),
    [
      "power|resource-boost:item_originium_ore:50",
      "power|resource-boost:item_iron_ore:25",
    ],
  );
  assert.equal(
    requests[0].exchangeSnapshot.powerBatteries.some((entry) => entry.matId === "item_proc_battery_5"),
    false,
  );
  assert.equal(
    requests[0].deductionSnapshot.powerBatteries.some((entry) => entry.matId === "item_proc_battery_5"),
    true,
  );
});

test("solved trade rates and bills only count scenario trade items", () => {
  const result = {
    netRates: {
      item_proc_battery_5: 2,
      item_copper_enr_cmpt: 1,
      item_liquid_water: 999,
    },
  };

  assert.deepEqual(globalThis.WulingCandidateEngine.solvedTradeRates(result, scenario), {
    item_proc_battery_5: 2,
    item_copper_enr_cmpt: 1,
  });
  assert.equal(globalThis.WulingCandidateEngine.billsPerHour(result, scenario), (2 * 54 + 1 * 48) * 60);
});

test("solving candidate requests fixes deduction pass production to exchange rates", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const [request] = globalThis.WulingCandidateEngine.buildCandidateRequests(snapshot, scenario, {
    policies: [{ id: "power", sequence: [] }],
  });
  const seen = [];
  const candidates = globalThis.WulingCandidateEngine.solveCandidateRequests(
    [request],
    scenario,
    (snap, options) => {
      seen.push({ snap, options });
      return {
        status: "optimal",
        netRates: {
          item_proc_battery_5: 12,
          item_xiranite_enr_powder: 10,
        },
      };
    },
  );

  assert.equal(candidates.length, 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].options.pinAll, false);
  assert.equal(seen[1].options.respectProductionMaxRate, true);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_proc_battery_5").rate, 12);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_proc_battery_5").maxRate, 12);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_proc_battery_5").locked, false);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_copper_enr_cmpt").rate, 0);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_copper_enr_cmpt").maxRate, 6);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_equip_script_4").rate, 0.6);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_equip_script_4").locked, true);
});

test("deduction pass preserves facility integer limits from the candidate snapshot", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  snapshot.facilityLimits = [
    {
      id: "forge",
      gameFacilityId: "xiranite_oven_1",
      name: "Forge of the Sky",
      cap: 12,
      integerOnly: true,
    },
  ];
  const [request] = globalThis.WulingCandidateEngine.buildCandidateRequests(snapshot, scenario, {
    policies: [{ id: "power", sequence: [] }],
  });
  const seen = [];

  globalThis.WulingCandidateEngine.solveCandidateRequests(
    [request],
    scenario,
    (snap, options) => {
      seen.push({ snap, options });
      return {
        status: "optimal",
        netRates: {
          item_proc_battery_5: 12,
          item_xiranite_enr_powder: 10,
        },
      };
    },
  );

  assert.equal(seen.length, 2);
  assert.equal(seen[0].snap.facilityLimits[0].integerOnly, true);
  assert.equal(seen[1].snap.facilityLimits[0].integerOnly, true);
  assert.equal(seen[1].options.phase, "deduction");
});

test("nearby candidates also run deduction-aware solve", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const seen = [];
  const candidates = globalThis.WulingCandidateEngine.solveNearbyCandidateSet(
    snapshot,
    scenario,
    {
      neighborhoodOptions: { maxItems: 1, maxPerItem: 1, granularities: [1] },
      solveSnapshot: (snap, options) => {
        seen.push({ snap, options });
        return {
          status: "optimal",
          netRates: {
            item_proc_battery_5: 13.5,
            item_xiranite_enr_powder: 12,
          },
        };
      },
    },
  );

  assert.equal(candidates.length, 1);
  assert.equal(seen.length, 3);
  assert.equal(seen[2].options.respectProductionMaxRate, true);
  assert.equal(seen[2].snap.production.find((entry) => entry.id === "item_equip_script_4").rate, 0.6);
  assert.equal(seen[2].snap.production.find((entry) => entry.id === "item_equip_script_4").locked, true);
});

test("policy solve options are centralized for later policy-specific execution", () => {
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: ["maximize-bills"] }, "exchange").pinAll,
    false,
  );
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: ["choose-integer-friendly-final-recipes"] }, "exchange").pinAll,
    true,
  );
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: ["choose-integer-friendly-final-recipes"] }, "exchange").pinTolerance,
    0,
  );
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: ["selected-current-rates"] }, "exchange").pinAll,
    true,
  );
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: ["selected-current-rates"] }, "exchange").pinTolerance,
    1e-4,
  );
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: [] }, "deduction").pinAll,
    false,
  );
  assert.equal(
    globalThis.WulingCandidateEngine.solveOptionsForPolicy({ sequence: [] }, "deduction").respectProductionMaxRate,
    true,
  );
});

test("candidate rows are ordered by bills and deduplicate equivalent outputs", () => {
  const candidates = [
    {
      id: "deduction-failed",
      policy: { id: "power", label: "Power" },
      variant: { id: "boost-a", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "infeasible" },
      summary: {
        deductionBillsPerHour: 999,
        exchangeBillsPerHour: 999,
        gapToMaxBillsPerHour: 999,
        totalFacilityUse: 1,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 99 }],
      },
    },
    {
      id: "b",
      policy: { id: "power", label: "Power" },
      variant: { id: "boost-a", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 100,
        exchangeBillsPerHour: 110,
        gapToMaxBillsPerHour: -5,
        totalFacilityUse: 4,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
    {
      id: "a",
      policy: { id: "power", label: "Power" },
      variant: { id: "boost-a", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 100,
        exchangeBillsPerHour: 110,
        gapToMaxBillsPerHour: -5,
        totalFacilityUse: 6,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
    {
      id: "c",
      policy: { id: "integer", label: "Integer" },
      variant: { id: "boost-b", label: "+25" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 120,
        exchangeBillsPerHour: 130,
        gapToMaxBillsPerHour: 10,
        totalFacilityUse: 8,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 2 }],
      },
    },
  ];

  const rows = globalThis.WulingCandidateEngine.candidateRows(candidates);

  assert.deepEqual(rows.map((row) => row.id), ["c", "b"]);
  assert.equal(rows[0].index, 1);
  assert.equal(rows[0].billsPerHour, 120);
});

test("candidate dedupe keeps the best equivalent output candidate", () => {
  const candidates = [
    {
      id: "higher-facility",
      variant: { id: "same-boost", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 100,
        totalFacilityUse: 9,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
    {
      id: "lower-facility",
      variant: { id: "same-boost", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 100,
        totalFacilityUse: 5,
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
  ];

  const rows = globalThis.WulingCandidateEngine.candidateRows(candidates);

  assert.deepEqual(rows.map((row) => row.id), ["lower-facility"]);
});

test("candidate dedupe keeps the current production selection marker row", () => {
  const sharedSummary = {
    deductionBillsPerHour: 100,
    totalFacilityUse: 5,
    billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
  };
  const candidates = [
    {
      id: "selected-row",
      policy: { id: "selected", label: "Selected" },
      variant: { id: "same-boost", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: sharedSummary,
    },
    {
      id: "power-row",
      policy: { id: "power", label: "Power" },
      variant: { id: "same-boost", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: sharedSummary,
    },
  ];

  const rows = globalThis.WulingCandidateEngine.candidateRows(candidates);

  assert.deepEqual(rows.map((row) => row.id), ["selected-row"]);
});

test("candidate ordering prefers build-friendly near ties", () => {
  const candidates = [
    {
      id: "higher-bills-more-splits",
      variant: { id: "boost-a", label: "+50" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 1000,
        totalFacilityUse: 5,
        buildability: { score: 1200 },
        billComposition: [{ itemId: "item_proc_battery_5", finalRate: 1 }],
      },
    },
    {
      id: "slightly-lower-bills-simple",
      variant: { id: "boost-b", label: "+25" },
      exchangeResult: { status: "optimal" },
      deductionResult: { status: "optimal" },
      summary: {
        deductionBillsPerHour: 995,
        totalFacilityUse: 5,
        buildability: { score: 0 },
        billComposition: [{ itemId: "item_copper_enr_cmpt", finalRate: 1 }],
      },
    },
  ];

  const rows = globalThis.WulingCandidateEngine.candidateRows(candidates);

  assert.deepEqual(rows.map((row) => row.id), ["slightly-lower-bills-simple", "higher-bills-more-splits"]);
});

test("nearby candidate set solves fixed-rate variants around a base power result", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const seen = [];
  const candidates = globalThis.WulingCandidateEngine.solveNearbyCandidateSet(
    snapshot,
    scenario,
    {
      neighborhoodOptions: { maxItems: 1, maxPerItem: 1, granularities: [1] },
      solveSnapshot: (snap, options) => {
        seen.push({ snap, options });
        if (seen.length === 1) {
          return {
            status: "optimal",
            netRates: {
              item_proc_battery_5: 13.5,
            },
          };
        }
        return {
          status: "optimal",
          netRates: {
            item_proc_battery_5: snap.production.find((entry) => entry.id === "item_proc_battery_5")?.rate ?? 0,
          },
        };
      },
    },
  );

  assert.equal(candidates.length, 1);
  assert.equal(seen.length, 3);
  assert.equal(candidates[0].policy.id, "nearby");
  assert.equal(candidates[0].variant.source.targetRate, 14);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_proc_battery_5").rate, 14);
  assert.equal(seen[1].snap.production.find((entry) => entry.id === "item_proc_battery_5").locked, true);
  assert.equal(seen[2].options.pinAll, false);
  assert.equal(seen[2].options.respectProductionMaxRate, true);
});

test("combined candidate set appends nearby variants for both resource boosts", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const seen = [];
  const candidates = globalThis.WulingCandidateEngine.solveCombinedCandidateSet(
    snapshot,
    scenario,
    {
      policies: [{ id: "power", label: "Power", sequence: [] }],
      neighborhoodOptions: { maxItems: 1, maxPerItem: 1, granularities: [1] },
      solveSnapshot: (snap, options) => {
        seen.push({ snap, options });
        return {
          status: "optimal",
          netRates: {
            item_proc_battery_5: snap.production.find((entry) => entry.id === "item_proc_battery_5")?.rate || 13.5,
          },
        };
      },
    },
  );

  assert.equal(candidates.some((candidate) => candidate.policy.id === "power"), true);
  assert.equal(candidates.some((candidate) => candidate.policy.id === "selected"), true);
  assert.equal(candidates.some((candidate) => candidate.policy.id === "nearby"), true);
  assert.equal(
    candidates.some((candidate) => candidate.policy.id === "nearby"
      && candidate.variant.boost?.itemId === "item_originium_ore"),
    true,
  );
  assert.equal(
    candidates.some((candidate) => candidate.policy.id === "nearby"
      && candidate.variant.boost?.itemId === "item_iron_ore"),
    true,
  );
  assert.equal(seen.length, 12);
});

test("nearby search keeps zero-split integer variants while exploring additional nearby options", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  globalThis.RECIPES_DB = {
    recipes: [{
      id: "recipe_a",
      craftingTime: 10,
      outputs: [{ itemId: "item_proc_battery_5", amount: 1 }],
    }, {
      id: "recipe_b",
      craftingTime: 10,
      outputs: [{ itemId: "item_copper_enr_cmpt", amount: 1 }],
    }],
  };
  const seen = [];
  const candidates = globalThis.WulingCandidateEngine.solveNearbyCandidateSet(
    snapshot,
    scenario,
    {
      neighborhoodOptions: { topCount: 2, maxCombos: 4, maxItems: 2, maxPerItem: 2 },
      solveSnapshot: (snap) => {
        seen.push(snap);
        if (seen.length === 1) {
          return {
            status: "optimal",
            recipeFacilityCounts: {
              recipe_a: 13.5,
              recipe_b: 4.25,
            },
            netRates: {
              item_proc_battery_5: 81,
              item_copper_enr_cmpt: 25.5,
            },
          };
        }
        return {
          status: "optimal",
          recipeFacilityCounts: {
            recipe_a: 14,
            recipe_b: 4,
          },
          netRates: {
            item_proc_battery_5: snap.production.find((entry) => entry.id === "item_proc_battery_5")?.rate ?? 0,
            item_copper_enr_cmpt: snap.production.find((entry) => entry.id === "item_copper_enr_cmpt")?.rate ?? 0,
          },
        };
      },
    },
  );

  assert.equal(candidates.length > 4, true);
  assert.equal(seen.length > 9, true);
  assert.equal(candidates.some((candidate) => candidate.summary.buildability.splitParentCount === 0), true);
});

test("nearby search deduplicates equivalent fixed conditions before solving", () => {
  const snapshot = globalThis.WulingStateSnapshot.createStateSnapshot(scenario.defaultState);
  const originalBuilder = globalThis.WulingCandidateNeighborhood.buildIntegerFacilityComboVariants;
  const originalRateBuilder = globalThis.WulingCandidateNeighborhood.buildNearbyRateVariants;
  globalThis.WulingCandidateNeighborhood.buildIntegerFacilityComboVariants = () => [
    {
      id: "same-a",
      fixedRates: [{
        itemId: "item_proc_battery_5",
        sourceRate: 72,
        targetRate: 72,
        rate: 72,
        sourceFacilityCount: 12,
        targetFacilityCount: 12,
      }],
      snapshot: globalThis.WulingCandidateNeighborhood.snapshotWithFixedRates(snapshot, [{
        itemId: "item_proc_battery_5",
        rate: 72,
      }]),
    },
    {
      id: "same-b",
      fixedRates: [{
        itemId: "item_proc_battery_5",
        sourceRate: 72,
        targetRate: 72,
        rate: 72,
        sourceFacilityCount: 12,
        targetFacilityCount: 12,
      }],
      snapshot: globalThis.WulingCandidateNeighborhood.snapshotWithFixedRates(snapshot, [{
        itemId: "item_proc_battery_5",
        rate: 72,
      }]),
    },
  ];
  globalThis.WulingCandidateNeighborhood.buildNearbyRateVariants = () => [];

  const seen = [];
  try {
    const candidates = globalThis.WulingCandidateEngine.solveNearbyCandidateSet(
      snapshot,
      scenario,
      {
        solveSnapshot: (snap) => {
          seen.push(snap);
          return {
            status: "optimal",
            netRates: {
              item_proc_battery_5: snap.production.find((entry) => entry.id === "item_proc_battery_5")?.rate || 13.5,
            },
          };
        },
      },
    );

    assert.equal(candidates.length, 1);
    assert.equal(seen.length, 3);
  } finally {
    globalThis.WulingCandidateNeighborhood.buildIntegerFacilityComboVariants = originalBuilder;
    globalThis.WulingCandidateNeighborhood.buildNearbyRateVariants = originalRateBuilder;
  }
});
