(function (global) {
  function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function scenarioTradeIds(scenario) {
    return new Set((scenario?.tradeItems ?? []).map((entry) => entry.itemId));
  }

  function applyResourceBoost(snapshot, boost) {
    const next = global.WulingStateSnapshot.createStateSnapshot(snapshot);
    if (!boost) return next;
    const row = next.rawLimits.find((entry) => entry.matId === boost.itemId);
    if (row) row.cap = Number(row.cap || 0) + Number(boost.amount || 0);
    else next.rawLimits.push({ matId: boost.itemId, cap: Number(boost.amount || 0) });
    return next;
  }

  function resourceBoostVariants(snapshot, scenario) {
    const boosts = scenario?.resourceBoosts ?? [];
    if (!boosts.length) return [{ id: "base", label: "Base", boost: null, snapshot: clonePlain(snapshot) }];
    return boosts.map((boost) => ({
      id: `resource-boost:${boost.itemId}:${boost.amount}`,
      label: `+${boost.amount}`,
      boost: clonePlain(boost),
      snapshot: applyResourceBoost(snapshot, boost),
    }));
  }

  function selectedResourceBoostVariant(snapshot, scenario) {
    const variants = resourceBoostVariants(snapshot, scenario);
    const selectedId = snapshot?.selectedResourceBoostId;
    return variants.find((variant) => variant.id === selectedId) ?? variants[0] ?? null;
  }

  function buildCandidateRequests(snapshot, scenario, options = {}) {
    const policies = options.policies
      ?? global.WulingCandidatePolicies.candidatePoliciesForScenario(scenario, options.policyOptions);
    const variants = resourceBoostVariants(snapshot, scenario);
    const requests = [];

    for (const policy of policies) {
      for (const variant of variants) {
        const deductionSnapshot = global.WulingDeductions
          ? global.WulingDeductions.solverSnapshot(variant.snapshot, scenario, { includeDeductions: true })
          : global.WulingStateSnapshot.deductionAwareSnapshot(variant.snapshot);
        const exchangeSnapshot = global.WulingDeductions
          ? global.WulingDeductions.solverSnapshot(variant.snapshot, scenario, { includeDeductions: false })
          : global.WulingStateSnapshot.exchangeOnlySnapshot(deductionSnapshot, scenario);
        requests.push({
          id: `${policy.id}|${variant.id}`,
          policy: clonePlain(policy),
          variant: {
            id: variant.id,
            label: variant.label,
            boost: clonePlain(variant.boost),
          },
          exchangeSnapshot,
          deductionSnapshot,
        });
      }
    }
    return requests;
  }

  function solveOptionsForPolicy(policy, phase) {
    const sequence = new Set(policy?.sequence ?? []);
    const usesSelectedCurrentRates = sequence.has("selected-current-rates");
    return {
      pinAll: phase !== "deduction" && (
        sequence.has("choose-integer-friendly-final-recipes")
        || usesSelectedCurrentRates
      ),
      pinTolerance: phase !== "deduction" && usesSelectedCurrentRates ? 1e-4 : 0,
      respectProductionMaxRate: phase === "deduction",
      prioritizeUnsellable: false,
      policy,
      phase,
    };
  }

  function solvedTradeRates(result, scenario) {
    const tradeIds = scenarioTradeIds(scenario);
    const rates = {};
    for (const [itemId, rate] of Object.entries(result?.netRates ?? {})) {
      if (tradeIds.has(itemId)) rates[itemId] = Math.max(0, Number(rate) || 0);
    }
    return rates;
  }

  function snapshotWithSolvedTradeRates(snapshot, result, scenario) {
    const next = global.WulingStateSnapshot.createStateSnapshot(snapshot);
    const rates = solvedTradeRates(result, scenario);
    const tradeIds = scenarioTradeIds(scenario);
    const deductionRates = global.WulingDeductions?.deductionRateMap?.(snapshot, scenario) ?? {};
    const seen = new Set();
    next.production = next.production.map((entry) => {
      seen.add(entry.id);
      if (tradeIds.has(entry.id)) {
        const solvedRate = rates[entry.id] ?? 0;
        return {
          ...entry,
          rate: solvedRate,
          maxRate: solvedRate > 1e-9 ? solvedRate : entry.maxRate,
          locked: false,
          optimized: true,
        };
      }
      if (deductionRates[entry.id] > 0) {
        return {
          ...entry,
          rate: deductionRates[entry.id],
          locked: true,
          optimized: true,
        };
      }
      return entry;
    });
    for (const [itemId, rate] of Object.entries(deductionRates)) {
      if (seen.has(itemId) || tradeIds.has(itemId) || rate <= 0) continue;
      next.production.push({
        id: itemId,
        recipeId: "",
        rate,
        locked: true,
        optimized: true,
      });
    }
    return next;
  }

  function withFacilityLimitsFrom(snapshot, source) {
    const next = global.WulingStateSnapshot.createStateSnapshot(snapshot);
    next.facilityLimits = clonePlain(source?.facilityLimits ?? []);
    return next;
  }

  function billsPerHour(result, scenario) {
    const rates = solvedTradeRates(result, scenario);
    const prices = Object.fromEntries((scenario?.tradeItems ?? []).map((entry) => [entry.itemId, entry.price]));
    return Object.entries(rates).reduce((sum, [itemId, rate]) => sum + rate * (prices[itemId] ?? 0) * 60, 0);
  }

  function solveCandidateRequests(requests, scenario, solveSnapshot, options = {}) {
    if (typeof solveSnapshot !== "function") {
      throw new TypeError("solveCandidateRequests requires a solveSnapshot function");
    }
    return requests.map((request) => {
      const exchangeResult = solveSnapshot(request.exchangeSnapshot, {
        ...solveOptionsForPolicy(request.policy, "exchange"),
        ...options.exchangeOptions,
      });
      let deductionResult = null;
      if (exchangeResult?.status === "optimal") {
        const fixedDeductionSnapshot = snapshotWithSolvedTradeRates(
          request.deductionSnapshot,
          exchangeResult,
          scenario,
        );
        deductionResult = solveSnapshot(withFacilityLimitsFrom(fixedDeductionSnapshot, request.deductionSnapshot), {
          ...solveOptionsForPolicy(request.policy, "deduction"),
          ...options.deductionOptions,
        });
      }
      const candidate = {
        ...request,
        exchangeResult,
        deductionResult,
        exchangeBillsPerHour: billsPerHour(exchangeResult, scenario),
        deductionBillsPerHour: billsPerHour(deductionResult, scenario),
      };
      const summarized = {
        ...candidate,
        summary: global.WulingSolutionSummary?.summarizeCandidate?.(candidate, scenario) ?? null,
      };
      return global.WulingCandidateBuildability?.annotateCandidate
        ? global.WulingCandidateBuildability.annotateCandidate(summarized, scenario, options.buildabilityOptions)
        : summarized;
    });
  }

  function solveCandidateSet(snapshot, scenario, options = {}) {
    const solveSnapshot = options.solveSnapshot ?? global.WulingSolverService?.solveSnapshot;
    const requests = buildCandidateRequests(snapshot, scenario, options);
    return solveCandidateRequests(requests, scenario, solveSnapshot, options);
  }

  function solveSelectedCandidateSet(snapshot, scenario, options = {}) {
    const variant = selectedResourceBoostVariant(snapshot, scenario);
    if (!variant) return [];
    const deductionSnapshot = global.WulingDeductions
      ? global.WulingDeductions.solverSnapshot(variant.snapshot, scenario, { includeDeductions: true })
      : global.WulingStateSnapshot.deductionAwareSnapshot(variant.snapshot);
    const exchangeSnapshot = global.WulingDeductions
      ? global.WulingDeductions.solverSnapshot(variant.snapshot, scenario, { includeDeductions: false })
      : global.WulingStateSnapshot.exchangeOnlySnapshot(deductionSnapshot, scenario);
    const request = {
      id: `selected|${variant.id}`,
      policy: {
        id: "selected",
        label: "Selected",
        sequence: ["selected-current-rates"],
      },
      variant: {
        id: variant.id,
        label: variant.label,
        boost: clonePlain(variant.boost),
      },
      exchangeSnapshot,
      deductionSnapshot,
    };
    return solveCandidateRequests([request], scenario, options.solveSnapshot ?? global.WulingSolverService?.solveSnapshot, options);
  }

  function solveNearbyCandidateSet(snapshot, scenario, options = {}) {
    const solveSnapshot = options.solveSnapshot ?? global.WulingSolverService?.solveSnapshot;
    if (typeof solveSnapshot !== "function") {
      throw new TypeError("solveNearbyCandidateSet requires a solveSnapshot function");
    }
    const basePolicy = options.basePolicy ?? {
      id: "power",
      label: "Low power max",
      sequence: ["maximize-bills", "minimize-power", "minimize-facilities"],
    };
    const baseSnapshot = global.WulingDeductions
      ? global.WulingDeductions.solverSnapshot(snapshot, scenario, { includeDeductions: false })
      : global.WulingStateSnapshot.exchangeOnlySnapshot(snapshot, scenario);
    const baseResult = solveSnapshot(baseSnapshot, {
      ...solveOptionsForPolicy(basePolicy, "exchange"),
      ...options.exchangeOptions,
    });
    if (baseResult?.status !== "optimal") {
      return [];
    }

    const rateVariants = global.WulingCandidateNeighborhood?.buildNearbyRateVariants?.(
      baseSnapshot,
      baseResult,
      scenario,
      options.neighborhoodOptions,
    ) ?? [];
    const integerFacilityVariants = global.WulingCandidateNeighborhood?.buildIntegerFacilityComboVariants?.(
      baseSnapshot,
      baseResult,
      scenario,
      options.neighborhoodOptions,
    ) ?? [];
    const resourceVariant = options.resourceVariant ?? null;
    const resourcePrefix = resourceVariant?.id ? `${resourceVariant.id}|` : "";
    const requestFromVariant = (variant) => {
      const deductionVariantSnapshot = variant.fixedRates && global.WulingCandidateNeighborhood?.snapshotWithFixedRates
        ? global.WulingCandidateNeighborhood.snapshotWithFixedRates(snapshot, variant.fixedRates)
        : global.WulingCandidateNeighborhood?.snapshotWithFixedRate
          ? global.WulingCandidateNeighborhood.snapshotWithFixedRate(snapshot, variant.itemId, variant.targetRate)
          : variant.snapshot;
      const deductionSnapshot = global.WulingDeductions
        ? global.WulingDeductions.solverSnapshot(deductionVariantSnapshot, scenario, { includeDeductions: true })
        : global.WulingStateSnapshot.deductionAwareSnapshot(deductionVariantSnapshot);
      return {
        id: `nearby|${resourcePrefix}${variant.id}`,
        policy: {
          id: "nearby",
          label: "Nearby",
          sequence: [variant.fixedRates ? "nearby-integer-facility-combo" : "nearby-fixed-rate", "maximize-bills", "minimize-power"],
          source: clonePlain(variant),
        },
        variant: {
          id: `${resourcePrefix}${variant.id}`,
          label: resourceVariant?.label ? `${resourceVariant.label} ${variant.targetRate}` : `${variant.targetRate}`,
          boost: clonePlain(resourceVariant?.boost ?? null),
          source: clonePlain(variant),
        },
        exchangeSnapshot: variant.snapshot,
        deductionSnapshot,
      };
    };
    const uniqueVariants = (variants) => {
      const seen = new Set();
      const out = [];
      for (const variant of variants ?? []) {
        const key = nearbyVariantConditionKey(variant, resourceVariant);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(variant);
      }
      return out;
    };

    const integerCandidates = [];
    for (const variant of uniqueVariants(integerFacilityVariants)) {
      const candidate = solveCandidateRequests([requestFromVariant(variant)], scenario, solveSnapshot, options)[0];
      if (candidate) integerCandidates.push(candidate);
    }
    const rateRequests = uniqueVariants(rateVariants).map(requestFromVariant);
    return [
      ...integerCandidates,
      ...solveCandidateRequests(rateRequests, scenario, solveSnapshot, options),
    ];
  }

  function nearbyVariantConditionKey(variant, resourceVariant) {
    const boost = resourceVariant?.boost;
    const boostKey = boost?.itemId ? `${boost.itemId}+${Number(boost.amount || 0)}` : "base";
    const fixedRates = variant?.fixedRates ?? [];
    if (fixedRates.length) {
      return [
        boostKey,
        ...fixedRates.map((entry) => [
          entry.itemId,
          Number(entry.targetFacilityCount ?? "").toFixed(6),
          Number(entry.targetRate ?? entry.rate ?? 0).toFixed(6),
        ].join(":")).sort(),
      ].join("|");
    }
    return [
      boostKey,
      variant?.itemId ?? "",
      Number(variant?.targetRate ?? 0).toFixed(6),
    ].join("|");
  }

  function solveCombinedCandidateSet(snapshot, scenario, options = {}) {
    const selected = options.includeSelected === false ? [] : solveSelectedCandidateSet(snapshot, scenario, options);
    const standard = solveCandidateSet(snapshot, scenario, options);
    const nearby = [];
    if (options.includeNearby !== false) {
      const nearbyVariants = resourceBoostVariants(snapshot, scenario);
      for (const variant of nearbyVariants) {
        nearby.push(...solveNearbyCandidateSet(variant.snapshot, scenario, {
          ...options,
          resourceVariant: variant,
          neighborhoodOptions: {
            maxItems: 4,
            maxPerItem: 2,
            topCount: 3,
            maxCombos: 10,
            relaxedMaxCombos: 10,
            granularities: [1, 0.5],
            ...(options.neighborhoodOptions ?? {}),
          },
        }));
      }
    }
    return [...selected, ...standard, ...nearby];
  }

  function isSelectedCandidate(candidate) {
    return candidate?.policy?.id === "selected";
  }

  function visibleTradeItemIds(candidate) {
    const scenarioItems = global.WULING_STOCK_BILL_SCENARIO?.tradeItems ?? [];
    const visible = scenarioItems
      .filter((entry) => entry?.defaultTarget !== false)
      .map((entry) => entry.itemId);
    if (visible.length) return new Set(visible);
    return new Set((candidate.summary?.billComposition ?? []).map((entry) => entry.itemId));
  }

  function roundedIdentityValue(value, digits = 2) {
    const number = Number(value) || 0;
    return Math.abs(number) < 1e-6 ? "0" : number.toFixed(digits);
  }

  function boostIdentity(candidate) {
    const boost = candidate.variant?.boost;
    if (!boost?.itemId || !boost?.amount) return "base";
    return `${boost.itemId}+${Number(boost.amount || 0)}`;
  }

  function candidateIdentity(candidate) {
    const visibleIds = visibleTradeItemIds(candidate);
    const composition = candidate.summary?.billComposition ?? [];
    const parts = composition
      .filter((entry) => visibleIds.has(entry.itemId))
      .map((entry) => [
        entry.itemId,
        roundedIdentityValue(entry.designRate, 2),
        roundedIdentityValue(entry.finalRate, 2),
      ].join(":"))
      .sort();
    const rawParts = Object.entries(candidate.summary?.rawUse ?? {})
      .map(([itemId, value]) => `${itemId}:${roundedIdentityValue(value, 1)}`)
      .sort();
    return [
      boostIdentity(candidate),
      ...parts,
      ...rawParts,
    ].join("|");
  }

  function shouldReplaceCandidate(candidate, current) {
    if (isSelectedCandidate(candidate) && !isSelectedCandidate(current)) return true;
    if (!isSelectedCandidate(candidate) && isSelectedCandidate(current)) return false;
    return compareCandidateOrder(candidate, current) < 0;
  }

  function orderCandidateResults(candidates, options = {}) {
    const rows = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const dedupe = options.dedupe !== false;
    const byIdentity = new Map();
    const filtered = [];
    for (const candidate of rows) {
      if (candidate.exchangeResult?.status !== "optimal") continue;
      if (candidate.deductionResult?.status !== "optimal") continue;
      const key = candidateIdentity(candidate);
      if (!dedupe) {
        filtered.push(candidate);
        continue;
      }
      const current = byIdentity.get(key);
      if (!current || shouldReplaceCandidate(candidate, current)) byIdentity.set(key, candidate);
    }
    return (dedupe ? [...byIdentity.values()] : filtered).sort(compareCandidateOrder);
  }

  function compareCandidateOrder(a, b) {
    const billDiff = (b.summary?.deductionBillsPerHour ?? b.deductionBillsPerHour ?? 0)
      - (a.summary?.deductionBillsPerHour ?? a.deductionBillsPerHour ?? 0);
    const nearTie = Math.abs(billDiff) <= Math.max(
      600,
      Math.max(
        b.summary?.deductionBillsPerHour ?? b.deductionBillsPerHour ?? 0,
        a.summary?.deductionBillsPerHour ?? a.deductionBillsPerHour ?? 0,
      ) * 0.01,
    );
    if (nearTie) {
      const buildabilityDiff = (a.summary?.buildability?.score ?? Infinity) - (b.summary?.buildability?.score ?? Infinity);
      if (Math.abs(buildabilityDiff) > 1e-6) return buildabilityDiff;
    }
    if (Math.abs(billDiff) > 1e-6) return billDiff;
    const facilityDiff = (a.summary?.totalFacilityUse ?? Infinity) - (b.summary?.totalFacilityUse ?? Infinity);
    if (Math.abs(facilityDiff) > 1e-6) return facilityDiff;
    return String(a.id).localeCompare(String(b.id));
  }

  function candidateRows(candidates, options = {}) {
    return orderCandidateResults(candidates, options).map((candidate, index) => ({
      index: index + 1,
      id: candidate.id,
      policyId: candidate.policy?.id ?? "",
      policyLabel: candidate.policy?.label ?? candidate.policy?.id ?? "",
      variantId: candidate.variant?.id ?? "",
      variantLabel: candidate.variant?.label ?? "",
      billsPerHour: candidate.summary?.deductionBillsPerHour ?? candidate.deductionBillsPerHour ?? 0,
      exchangeBillsPerHour: candidate.summary?.exchangeBillsPerHour ?? candidate.exchangeBillsPerHour ?? 0,
      gapToMaxBillsPerHour: candidate.summary?.gapToMaxBillsPerHour ?? 0,
      totalFacilityUse: candidate.summary?.totalFacilityUse ?? 0,
      status: candidate.summary?.deductionStatus ?? candidate.deductionResult?.status ?? "missing",
      summary: candidate.summary ?? null,
      candidate,
    }));
  }

  global.WulingCandidateEngine = {
    applyResourceBoost,
    billsPerHour,
    buildCandidateRequests,
    candidateIdentity,
    candidateRows,
    compareCandidateOrder,
    orderCandidateResults,
    resourceBoostVariants,
    selectedResourceBoostVariant,
    solveCombinedCandidateSet,
    solveOptionsForPolicy,
    solveNearbyCandidateSet,
    nearbyVariantConditionKey,
    snapshotWithSolvedTradeRates,
    solveCandidateRequests,
    solveCandidateSet,
    solveSelectedCandidateSet,
    solvedTradeRates,
  };
})(globalThis);
