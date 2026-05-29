(function (global) {
  function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function scenarioPrices(scenario) {
    const prices = {};
    for (const item of scenario?.tradeItems ?? []) {
      if (Number(item.price) > 0) prices[item.itemId] = Number(item.price);
    }
    return prices;
  }

  function buildScenarioDefaultState(scenario, db = {}) {
    if (!scenario) return null;
    if (scenario.defaultState) return clonePlain(scenario.defaultState);

    const recipesByOutput = db.recipesByOutput ?? {};
    const facilityById = db.facilityById ?? {};

    return {
      production: (scenario.tradeItems ?? [])
        .filter((entry) => entry.defaultTarget !== false)
        .map((entry) => ({
          id: entry.itemId,
          recipeId: recipesByOutput[entry.itemId]?.[0]?.id ?? "",
          rate: Number(entry.defaultRate ?? 0),
          locked: false,
          optimized: false,
        })),
      rawLimits: (scenario.constrainedResources ?? []).map((entry) => ({
        matId: entry.itemId,
        cap: Number(entry.defaultCap ?? 0),
      })),
      facilityLimits: (scenario.constrainedFacilities ?? []).map((entry) => {
        const facility = facilityById[entry.facilityId];
        return {
          id: entry.facilityId,
          gameFacilityId: entry.facilityId,
          name: facility?.name ?? entry.name ?? entry.facilityId,
          cap: Number(entry.defaultCap ?? 0),
          integerOnly: !!entry.integerOnly,
        };
      }),
      powerBatteries: (scenario.deductions ?? [])
        .filter((entry) => Number(entry.defaultRate ?? 0) > 0)
        .map((entry) => ({
          matId: entry.itemId,
          rate: Number(entry.defaultRate ?? 0),
        })),
      prices: scenarioPrices(scenario),
      autoSolve: true,
      prioritizeUnsellable: false,
      outpostCost: Number(scenario.maxBillsPerHour ?? 0),
    };
  }

  global.WulingScenarioState = {
    buildScenarioDefaultState,
    clonePlain,
    scenarioPrices,
  };
})(globalThis);

