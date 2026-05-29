/*
 * Nearby candidate helpers.
 *
 * The practical Wuling workflow starts from a strong continuous solution and
 * then explores build-friendly values around it.  This module only creates
 * those nearby target snapshots; solving and ranking remain in candidate-engine.
 */
(function (global) {
  function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function tradePriceMap(scenario) {
    return Object.fromEntries((scenario?.tradeItems ?? []).map((entry) => [entry.itemId, Number(entry.price || 0)]));
  }

  function baselineTradeRates(result, scenario) {
    if (global.WulingCandidateEngine?.solvedTradeRates) {
      return global.WulingCandidateEngine.solvedTradeRates(result, scenario);
    }
    const ids = new Set((scenario?.tradeItems ?? []).map((entry) => entry.itemId));
    const rates = {};
    for (const [itemId, value] of Object.entries(result?.netRates ?? {})) {
      if (ids.has(itemId)) rates[itemId] = Math.max(0, Number(value) || 0);
    }
    return rates;
  }

  function recipeById(result, recipeId) {
    if (result?.graph?.recipeNodes?.get) {
      const graphRecipe = result.graph.recipeNodes.get(recipeId);
      if (graphRecipe) return graphRecipe;
    }
    return (global.RECIPES_DB?.recipes ?? []).find((entry) => entry?.id === recipeId) || null;
  }

  function recipeCountEntries(result) {
    const counts = result?.recipeFacilityCounts;
    if (!counts) return [];
    if (counts instanceof Map) return [...counts.entries()];
    return Object.entries(counts);
  }

  function recipeOutputs(recipe) {
    return Array.isArray(recipe?.outputs)
      ? recipe.outputs
      : Object.entries(recipe?.outputs ?? {}).map(([itemId, amount]) => ({ itemId, amount }));
  }

  function roundedValuesNear(rate, options = {}) {
    const value = Number(rate) || 0;
    const granularities = options.granularities ?? [1, 0.5];
    const maxDistance = Number(options.maxDistance ?? 1);
    const values = new Set();
    for (const step of granularities) {
      if (!step || step <= 0) continue;
      const down = Math.floor(value / step) * step;
      const up = Math.ceil(value / step) * step;
      [down, up].forEach((candidate) => {
        if (candidate < 0) return;
        if (Math.abs(candidate - value) < 1e-9) return;
        if (Math.abs(candidate - value) > maxDistance + 1e-9) return;
        values.add(Number(candidate.toFixed(6)));
      });
    }
    return [...values].sort((a, b) => Math.abs(a - value) - Math.abs(b - value) || b - a);
  }

  function snapshotWithFixedRate(snapshot, itemId, rate) {
    return snapshotWithFixedRates(snapshot, [{ itemId, rate }]);
  }

  function snapshotWithFixedRates(snapshot, fixedRates) {
    const next = global.WulingStateSnapshot?.createStateSnapshot
      ? global.WulingStateSnapshot.createStateSnapshot(snapshot)
      : clonePlain(snapshot);
    for (const fixed of fixedRates ?? []) {
      const itemId = fixed?.itemId;
      const rate = Number(fixed?.rate) || 0;
      if (!itemId) continue;
      const row = next.production.find((entry) => entry.id === itemId);
      if (row) {
        row.rate = rate;
        row.locked = true;
        row.optimized = false;
      } else {
        next.production.push({ id: itemId, recipeId: "", rate, locked: true, optimized: false });
      }
    }
    return next;
  }

  function topFinalRecipeRows(baselineResult, scenario, options = {}) {
    const prices = tradePriceMap(scenario);
    const excludeUnitPrice = options.excludeUnitPrice !== false;
    const rows = [];
    for (const [recipeId, rawCount] of recipeCountEntries(baselineResult)) {
      const facilityCount = Number(rawCount) || 0;
      if (!(facilityCount > 1e-9)) continue;
      const recipe = recipeById(baselineResult, recipeId);
      if (!recipe) continue;
      for (const output of recipeOutputs(recipe)) {
        const price = prices[output?.itemId] ?? 0;
        if (!(price > 0) || (excludeUnitPrice && price <= 1)) continue;
        const amount = Number(output.amount) || 0;
        const seconds = Number(recipe.craftingTime) || 1;
        const ratePerFacility = amount * 60 / seconds;
        const sourceRate = facilityCount * ratePerFacility;
        const billsPerHour = sourceRate * price * 60;
        if (!(sourceRate > 1e-9) || !(ratePerFacility > 1e-9)) continue;
        rows.push({
          itemId: output.itemId,
          recipeId,
          price,
          facilityCount,
          ratePerFacility,
          sourceRate,
          billsPerHour,
        });
      }
    }
    return rows.sort((a, b) => b.billsPerHour - a.billsPerHour || b.price - a.price || a.itemId.localeCompare(b.itemId));
  }

  function integerFacilityTargets(row, options = {}) {
    const maxFacilityDistance = Number(options.maxFacilityDistance ?? 1);
    const base = Number(row?.facilityCount) || 0;
    const values = new Set([Math.floor(base), Math.ceil(base)]);
    return [...values]
      .filter((facilityCount) => facilityCount > 0)
      .filter((facilityCount) => Math.abs(facilityCount - base) <= maxFacilityDistance + 1e-9)
      .map((facilityCount) => ({
        facilityCount,
        targetRate: Number((facilityCount * row.ratePerFacility).toFixed(6)),
      }))
      .filter((entry) => Math.abs(entry.targetRate - row.sourceRate) > 1e-7)
      .sort((a, b) => Math.abs(a.facilityCount - base) - Math.abs(b.facilityCount - base) || b.facilityCount - a.facilityCount);
  }

  function integerKeepTargets(row) {
    const base = Number(row?.facilityCount) || 0;
    const rounded = Math.round(base);
    if (rounded > 0 && Math.abs(rounded - base) <= 1e-6) {
      return [{
        facilityCount: rounded,
        targetRate: Number((rounded * row.ratePerFacility).toFixed(6)),
      }];
    }
    return integerFacilityTargets(row).slice(0, 1);
  }

  function lowFacilitySnapTargets(row, options = {}) {
    const base = Number(row?.facilityCount) || 0;
    const maxBase = Number(options.lowFacilityMaxBase ?? 1.25);
    if (!(base > 0) || base > maxBase + 1e-9) return [];
    const snapPoints = options.lowFacilitySnapPoints ?? [0.5, 1];
    return [...new Set(snapPoints.map((value) => Number(Number(value).toFixed(6))))]
      .filter((facilityCount) => facilityCount > 0)
      .filter((facilityCount) => Math.abs(facilityCount - base) > 1e-6)
      .sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || b - a)
      .map((facilityCount) => ({
        facilityCount,
        targetRate: Number((facilityCount * row.ratePerFacility).toFixed(6)),
      }));
  }

  function cleanLowerFacilityTargets(row, options = {}) {
    const base = Number(row?.facilityCount) || 0;
    const current = Math.floor(base + 1e-6);
    const values = new Set();
    if (current > 1) values.add(current - 1);
    if (current >= 2) values.add(Math.max(1, Math.floor(current / 2)));
    for (const step of options.cleanFacilitySteps ?? [12, 6, 4, 3, 2]) {
      if (!step || step <= 1) continue;
      const lowered = Math.floor((base - 1e-6) / step) * step;
      if (lowered > 0 && lowered < base - 1e-6) values.add(lowered);
    }
    return [...values]
      .filter((facilityCount) => facilityCount > 0 && facilityCount < base - 1e-6)
      .sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || b - a)
      .map((facilityCount) => ({
        facilityCount,
        targetRate: Number((facilityCount * row.ratePerFacility).toFixed(6)),
      }));
  }

  function fixedRatesFromEntries(entries) {
    return entries.map((entry) => ({
      itemId: entry.row.itemId,
      sourceRate: entry.row.sourceRate,
      targetRate: entry.targetRate,
      rate: entry.targetRate,
      sourceFacilityCount: entry.row.facilityCount,
      targetFacilityCount: entry.facilityCount,
    }));
  }

  function variantFromFixedRates(snapshot, fixedRates, mode) {
    const id = fixedRates
      .map((entry) => `${entry.itemId}:${entry.targetFacilityCount}`)
      .join("+");
    return {
      id: `nearby-facility-${mode}:${id}`,
      itemId: fixedRates[0]?.itemId ?? "",
      price: 0,
      sourceRate: fixedRates[0]?.sourceRate ?? 0,
      targetRate: fixedRates[0]?.targetRate ?? 0,
      fixedRates,
      snapshot: snapshotWithFixedRates(snapshot, fixedRates),
    };
  }

  function combineTargetSets(sets, limit = 4) {
    let combos = [[]];
    for (const set of sets) {
      combos = combos.flatMap((combo) => set.map((entry) => [...combo, entry]));
    }
    return combos.slice(0, limit);
  }

  function pushUniqueVariant(variants, seen, variant, limit) {
    if (!variant?.fixedRates?.length) return;
    if (seen.has(variant.id)) return;
    if (variants.length >= limit) return;
    seen.add(variant.id);
    variants.push(variant);
  }

  function buildIntegerFacilityComboVariants(snapshot, baselineResult, scenario, options = {}) {
    const topCount = Number(options.topCount ?? 3);
    const maxCombos = Number(options.maxCombos ?? 10);
    const allRows = topFinalRecipeRows(baselineResult, scenario, options);
    const rows = allRows.slice(0, topCount);
    if (!rows.length) return [];
    const targetSets = rows.map((row) => integerFacilityTargets(row, options)
      .map((target) => ({ ...target, row })));
    const variants = [];
    const seen = new Set();
    const lowSnapMax = Number(options.lowSnapMaxCombos ?? Math.min(4, maxCombos));
    const lowSnapPerItem = Number(options.lowSnapMaxPerItem ?? 2);
    const lowRows = allRows.slice(0, Number(options.lowFacilityTopCount ?? Math.max(topCount, 8)));
    for (const row of lowRows) {
      const lowTargets = lowFacilitySnapTargets(row, options).slice(0, lowSnapPerItem);
      for (const target of lowTargets) {
        pushUniqueVariant(
          variants,
          seen,
          variantFromFixedRates(snapshot, fixedRatesFromEntries([{ ...target, row }]), "low-snap"),
          lowSnapMax,
        );
      }
    }

    const fullRows = targetSets.every((set) => set.length);
    if (fullRows) {
      for (const combo of combineTargetSets(targetSets, maxCombos)) {
        pushUniqueVariant(variants, seen, variantFromFixedRates(snapshot, fixedRatesFromEntries(combo), "integer"), maxCombos);
      }
    }

    const keepSets = rows.map((row) => integerKeepTargets(row).map((target) => ({ ...target, row })));
    const relaxedMax = Number(options.relaxedMaxCombos ?? maxCombos);
    if (rows.length >= 2) {
      for (let relaxedIndex = 0; relaxedIndex < rows.length; relaxedIndex += 1) {
        const entries = keepSets
          .map((set, index) => (index === relaxedIndex ? null : set[0]))
          .filter(Boolean);
        pushUniqueVariant(
          variants,
          seen,
          variantFromFixedRates(snapshot, fixedRatesFromEntries(entries), `relax-${relaxedIndex + 1}`),
          relaxedMax,
        );
      }
    }

    if (rows.length >= 3) {
      for (let loweredIndex = 0; loweredIndex < rows.length; loweredIndex += 1) {
        const loweredTargets = cleanLowerFacilityTargets(rows[loweredIndex], options).slice(0, 2);
        for (const lowered of loweredTargets) {
          for (let keepIndex = 0; keepIndex < rows.length; keepIndex += 1) {
            if (keepIndex === loweredIndex) continue;
            const keep = keepSets[keepIndex]?.[0];
            if (!keep) continue;
            const entries = [
              { ...lowered, row: rows[loweredIndex] },
              keep,
            ];
            pushUniqueVariant(
              variants,
              seen,
              variantFromFixedRates(snapshot, fixedRatesFromEntries(entries), `lower-${loweredIndex + 1}-keep-${keepIndex + 1}`),
              relaxedMax,
            );
          }
        }
      }
    }

    return variants;
  }

  function pricesForScenario(scenario) {
    return tradePriceMap(scenario);
  }

  function buildNearbyRateVariants(snapshot, baselineResult, scenario, options = {}) {
    const rates = baselineTradeRates(baselineResult, scenario);
    const prices = tradePriceMap(scenario);
    const excludeUnitPrice = options.excludeUnitPrice !== false;
    const maxItems = Number(options.maxItems ?? 8);
    const maxPerItem = Number(options.maxPerItem ?? 2);
    const tradeItems = (scenario?.tradeItems ?? [])
      .filter((entry) => Number(rates[entry.itemId] || 0) > 1e-9)
      .filter((entry) => !excludeUnitPrice || Number(entry.price || 0) > 1)
      .sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
      .slice(0, maxItems);

    const variants = [];
    for (const entry of tradeItems) {
      const sourceRate = Number(rates[entry.itemId] || 0);
      const targets = roundedValuesNear(sourceRate, options).slice(0, maxPerItem);
      for (const targetRate of targets) {
        variants.push({
          id: `nearby-rate:${entry.itemId}:${targetRate}`,
          itemId: entry.itemId,
          price: prices[entry.itemId] ?? 0,
          sourceRate,
          targetRate,
          deltaRate: targetRate - sourceRate,
          snapshot: snapshotWithFixedRate(snapshot, entry.itemId, targetRate),
        });
      }
    }
    return variants;
  }

  global.WulingCandidateNeighborhood = {
    baselineTradeRates,
    buildIntegerFacilityComboVariants,
    buildNearbyRateVariants,
    cleanLowerFacilityTargets,
    integerFacilityTargets,
    integerKeepTargets,
    lowFacilitySnapTargets,
    roundedValuesNear,
    snapshotWithFixedRate,
    snapshotWithFixedRates,
    topFinalRecipeRows,
  };
})(globalThis);
