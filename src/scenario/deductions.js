(function (global) {
  function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function scenarioDeductionIds(scenario) {
    return new Set((scenario?.deductions ?? []).map((entry) => entry.itemId));
  }

  function normalizeDeductions(snapshot, scenario) {
    const scenarioIds = scenarioDeductionIds(scenario);
    const explicit = Array.isArray(snapshot?.deductions) ? snapshot.deductions : [];
    const legacy = (snapshot?.powerBatteries ?? [])
      .filter((entry) => scenarioIds.has(entry.matId))
      .map((entry) => ({
        itemId: entry.matId,
        rate: Number(entry.rate || 0),
        source: "legacy-power-batteries",
      }));
    return [...explicit.map((entry) => ({
      itemId: entry.itemId,
      rate: Number(entry.rate || 0),
      source: entry.source ?? "deductions",
    })), ...legacy]
      .filter((entry) => entry.itemId && entry.rate > 0);
  }

  function deductionRateMap(snapshot, scenario) {
    const rates = {};
    for (const entry of normalizeDeductions(snapshot, scenario)) {
      rates[entry.itemId] = (rates[entry.itemId] ?? 0) + entry.rate;
    }
    return rates;
  }

  function toSolverPowerBatteries(snapshot, scenario, options = {}) {
    const includeDeductions = options.includeDeductions !== false;
    const scenarioIds = scenarioDeductionIds(scenario);
    const nonDeductionRows = (snapshot?.powerBatteries ?? [])
      .filter((entry) => !scenarioIds.has(entry.matId))
      .map((entry) => clonePlain(entry));
    if (!includeDeductions) return nonDeductionRows;
    const deductionRows = Object.entries(deductionRateMap(snapshot, scenario))
      .map(([matId, rate]) => ({ matId, rate }));
    return [...nonDeductionRows, ...deductionRows];
  }

  function solverSnapshot(snapshot, scenario, options = {}) {
    const next = global.WulingStateSnapshot.createStateSnapshot(snapshot);
    next.powerBatteries = toSolverPowerBatteries(snapshot, scenario, options);
    return next;
  }

  global.WulingDeductions = {
    deductionRateMap,
    normalizeDeductions,
    scenarioDeductionIds,
    solverSnapshot,
    toSolverPowerBatteries,
  };
})(globalThis);
