(function (global) {
  function tradePriceMap(scenario) {
    return Object.fromEntries((scenario?.tradeItems ?? []).map((entry) => [entry.itemId, Number(entry.price || 0)]));
  }

  function tradeIds(scenario) {
    return new Set((scenario?.tradeItems ?? []).map((entry) => entry.itemId));
  }

  function positiveTradeRates(result, scenario) {
    const ids = tradeIds(scenario);
    const rates = {};
    for (const [itemId, value] of Object.entries(result?.netRates ?? {})) {
      if (ids.has(itemId)) rates[itemId] = Math.max(0, Number(value) || 0);
    }
    return rates;
  }

  function recipeOutputs(recipe) {
    if (Array.isArray(recipe?.outputs)) return recipe.outputs;
    return Object.entries(recipe?.outputs ?? {}).map(([itemId, amount]) => ({ itemId, amount }));
  }

  function recipeInputs(recipe) {
    if (Array.isArray(recipe?.inputs)) return recipe.inputs;
    return Object.entries(recipe?.inputs ?? {}).map(([itemId, amount]) => ({ itemId, amount }));
  }

  function uniqueRecipeByOutputItem() {
    const outputToRecipes = new Map();
    for (const recipe of global.RECIPES_DB?.recipes ?? []) {
      for (const output of recipeOutputs(recipe)) {
        if (!(Number(output?.amount) > 0)) continue;
        const recipes = outputToRecipes.get(output.itemId) ?? [];
        recipes.push(recipe);
        outputToRecipes.set(output.itemId, recipes);
      }
    }
    return new Map([...outputToRecipes.entries()]
      .filter(([, recipes]) => recipes.length === 1)
      .map(([itemId, recipes]) => [itemId, recipes[0]]));
  }

  function directDeductionEquivalentRates(snapshot, scenario) {
    const ids = tradeIds(scenario);
    const exact = {};
    const equivalent = {};
    const recipeByOutput = uniqueRecipeByOutputItem();
    const deductionRates = global.WulingDeductions?.deductionRateMap(snapshot, scenario) ?? {};
    for (const [deductionItemId, requiredRate] of Object.entries(deductionRates)) {
      const rate = Number(requiredRate) || 0;
      if (!(rate > 0)) continue;
      if (ids.has(deductionItemId)) {
        exact[deductionItemId] = (exact[deductionItemId] ?? 0) + rate;
        continue;
      }
      const recipe = recipeByOutput.get(deductionItemId);
      if (!recipe) continue;
      const output = recipeOutputs(recipe).find((entry) => entry?.itemId === deductionItemId);
      const outputAmount = Number(output?.amount) || 0;
      if (!(outputAmount > 0)) continue;
      const runsPerMinute = rate / outputAmount;
      for (const input of recipeInputs(recipe)) {
        if (!ids.has(input?.itemId)) continue;
        equivalent[input.itemId] = (equivalent[input.itemId] ?? 0) + runsPerMinute * (Number(input.amount) || 0);
      }
    }
    return { exact, equivalent };
  }

  function billPerHourFromRates(rates, scenario) {
    const prices = tradePriceMap(scenario);
    return Object.entries(rates).reduce((sum, [itemId, rate]) => sum + rate * (prices[itemId] ?? 0) * 60, 0);
  }

  function summarizeBillComposition(candidate, scenario) {
    const designRates = positiveTradeRates(candidate.exchangeResult, scenario);
    const deductionGrossRates = positiveTradeRates(candidate.deductionResult, scenario);
    const deductionRates = directDeductionEquivalentRates(candidate.deductionSnapshot, scenario);
    const prices = tradePriceMap(scenario);
    const ids = new Set([
      ...Object.keys(designRates),
      ...Object.keys(deductionGrossRates),
      ...Object.keys(deductionRates.exact),
      ...Object.keys(deductionRates.equivalent),
    ]);
    return [...ids].map((itemId) => {
      const designRate = designRates[itemId] ?? 0;
      const finalGrossRate = deductionGrossRates[itemId] ?? 0;
      const exactDirectRate = deductionRates.exact[itemId] ?? 0;
      const finalRate = Math.max(0, finalGrossRate - exactDirectRate);
      const equivalentDirectRate = deductionRates.equivalent[itemId] ?? 0;
      const directDeductionRate = exactDirectRate + equivalentDirectRate;
      const solverAdjustmentRate = finalRate - (designRate - directDeductionRate);
      return {
        itemId,
        price: prices[itemId] ?? 0,
        designRate,
        directDeductionRate,
        finalGrossRate,
        solverAdjustmentRate,
        finalRate,
        finalBillsPerHour: finalRate * (prices[itemId] ?? 0) * 60,
      };
    })
      .filter((entry) => (
        entry.designRate > 1e-9
        || entry.directDeductionRate > 1e-9
        || entry.finalGrossRate > 1e-9
        || entry.finalRate > 1e-9
      ))
      .sort((a, b) => (b.price - a.price) || a.itemId.localeCompare(b.itemId));
  }

  function summarizeCandidate(candidate, scenario) {
    const billComposition = summarizeBillComposition(candidate, scenario);
    const exchangeBillsPerHour = billPerHourFromRates(positiveTradeRates(candidate.exchangeResult, scenario), scenario);
    const deductionBillsPerHour = billComposition.reduce((sum, entry) => sum + entry.finalBillsPerHour, 0);
    const maxBillsPerHour = Number(scenario?.maxBillsPerHour || 0);
    return {
      id: candidate.id,
      policyId: candidate.policy?.id ?? "",
      variantId: candidate.variant?.id ?? "",
      exchangeStatus: candidate.exchangeResult?.status ?? "missing",
      deductionStatus: candidate.deductionResult?.status ?? "missing",
      exchangeBillsPerHour,
      deductionBillsPerHour,
      maxBillsPerHour,
      gapToMaxBillsPerHour: maxBillsPerHour ? deductionBillsPerHour - maxBillsPerHour : 0,
      billComposition,
      rawUse: candidate.deductionResult?.rawUse ?? candidate.exchangeResult?.rawUse ?? {},
      facUse: candidate.deductionResult?.facUse ?? candidate.exchangeResult?.facUse ?? {},
      totalFacilityUse: Object.values(candidate.deductionResult?.facUse ?? candidate.exchangeResult?.facUse ?? {})
        .reduce((sum, value) => sum + (Number(value) || 0), 0),
    };
  }

  global.WulingSolutionSummary = {
    billPerHourFromRates,
    positiveTradeRates,
    summarizeBillComposition,
    summarizeCandidate,
    tradePriceMap,
  };
})(globalThis);
