/*
 * Buildability scoring for practical Wuling candidates.
 *
 * This is intentionally a ranking aid, not a solver constraint.  The solver
 * still finds feasible production plans; this layer helps choose plans that
 * are easier to build by looking at fractional final-recipe facility counts.
 */
(function (global) {
  const FRACTIONS = [
    { value: 0, denominator: 1 },
    { value: 1 / 8, denominator: 8 },
    { value: 1 / 6, denominator: 6 },
    { value: 1 / 4, denominator: 4 },
    { value: 1 / 3, denominator: 3 },
    { value: 1 / 2, denominator: 2 },
    { value: 2 / 3, denominator: 3 },
    { value: 3 / 4, denominator: 4 },
    { value: 5 / 6, denominator: 6 },
    { value: 7 / 8, denominator: 8 },
  ];

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

  function fractionalPart(value) {
    const raw = Math.abs(Number(value) || 0);
    const fraction = raw - Math.floor(raw);
    if (fraction < 1e-6 || 1 - fraction < 1e-6) return 0;
    return fraction;
  }

  function splitterDepth(denominator) {
    let rest = Math.max(1, Math.round(Number(denominator) || 1));
    let depth = 0;
    while (rest > 1 && rest % 2 === 0) {
      rest /= 2;
      depth += 1;
    }
    while (rest > 1 && rest % 3 === 0) {
      rest /= 3;
      depth += 1;
    }
    return rest === 1 ? depth : depth + 2;
  }

  function closestFraction(value) {
    const fraction = fractionalPart(value);
    if (!fraction) return { value: 0, denominator: 1, error: 0, splitters: 0 };
    const best = FRACTIONS
      .map((entry) => ({
        ...entry,
        error: Math.abs(entry.value - fraction),
        splitters: splitterDepth(entry.denominator),
      }))
      .sort((a, b) => a.error - b.error || a.splitters - b.splitters)[0];
    return best ?? { value: fraction, denominator: 1, error: 0, splitters: 0 };
  }

  function tradePriceMap(scenario) {
    return Object.fromEntries((scenario?.tradeItems ?? []).map((entry) => [entry.itemId, Number(entry.price || 0)]));
  }

  function targetRecipeRows(candidate, scenario, options = {}) {
    const result = candidate?.exchangeResult;
    const prices = tradePriceMap(scenario);
    const tradeIds = new Set(Object.keys(prices));
    const rows = [];
    for (const [recipeId, rawCount] of recipeCountEntries(result)) {
      const facilityCount = Number(rawCount) || 0;
      if (!(facilityCount > 1e-9)) continue;
      const recipe = recipeById(result, recipeId);
      if (!recipe) continue;
      for (const output of recipeOutputs(recipe)) {
        if (!tradeIds.has(output?.itemId)) continue;
        const amount = Number(output.amount) || 0;
        const seconds = Number(recipe.craftingTime) || 1;
        const rate = facilityCount * (60 / seconds) * amount;
        const billsPerHour = rate * (prices[output.itemId] ?? 0) * 60;
        if (!(billsPerHour > 1e-9)) continue;
        rows.push({
          itemId: output.itemId,
          recipeId,
          facilityCount,
          billsPerHour,
        });
      }
    }
    const totalBills = rows.reduce((sum, row) => sum + row.billsPerHour, 0);
    const coverage = Number(options.coverage ?? 0.75);
    let covered = 0;
    return rows
      .sort((a, b) => b.billsPerHour - a.billsPerHour || a.itemId.localeCompare(b.itemId))
      .filter((row) => {
        if (!(totalBills > 0)) return false;
        if (covered / totalBills >= coverage && covered > 0) return false;
        covered += row.billsPerHour;
        return true;
      });
  }

  function evaluateCandidate(candidate, scenario, options = {}) {
    const rows = targetRecipeRows(candidate, scenario, options);
    let splitParentCount = 0;
    let splitCount = 0;
    let error = 0;
    for (const row of rows) {
      const fraction = closestFraction(row.facilityCount);
      if (fraction.splitters > 0 || fraction.error > 1e-4) {
        splitParentCount += 1;
        splitCount += fraction.splitters;
        error += fraction.error;
      }
    }
    return {
      coveredRecipeCount: rows.length,
      splitParentCount,
      splitCount,
      fractionError: error,
      score: splitParentCount * 1000 + splitCount * 100 + error,
    };
  }

  function annotateCandidate(candidate, scenario, options = {}) {
    const buildability = evaluateCandidate(candidate, scenario, options);
    return {
      ...candidate,
      summary: {
        ...(candidate.summary ?? {}),
        buildability,
      },
    };
  }

  global.WulingCandidateBuildability = {
    annotateCandidate,
    closestFraction,
    evaluateCandidate,
    targetRecipeRows,
  };
})(globalThis);
