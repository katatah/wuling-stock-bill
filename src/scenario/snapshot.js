(function (global) {
  function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createStateSnapshot(state) {
    return {
      production: clonePlain(state.production ?? []),
      rawLimits: clonePlain(state.rawLimits ?? []),
      facilityLimits: clonePlain(state.facilityLimits ?? []),
      powerBatteries: clonePlain(state.powerBatteries ?? []),
      deductions: clonePlain(state.deductions ?? []),
      prices: clonePlain(state.prices ?? {}),
      recipeOptions: clonePlain(state.recipeOptions ?? {}),
      autoSolve: state.autoSolve !== false,
      prioritizeUnsellable: !!state.prioritizeUnsellable,
      selectedResourceBoostId: state.selectedResourceBoostId ?? "",
      outpostCost: Number(state.outpostCost ?? 0),
    };
  }

  function exchangeOnlySnapshot(snapshot, scenario) {
    if (global.WulingDeductions) return global.WulingDeductions.solverSnapshot(snapshot, scenario, { includeDeductions: false });
    const deductionItemIds = new Set((scenario?.deductions ?? []).map((entry) => entry.itemId));
    const next = createStateSnapshot(snapshot);
    next.powerBatteries = next.powerBatteries.filter((entry) => !deductionItemIds.has(entry.matId));
    next.deductions = [];
    return next;
  }

  function deductionAwareSnapshot(snapshot) {
    return createStateSnapshot(snapshot);
  }

  global.WulingStateSnapshot = {
    clonePlain,
    createStateSnapshot,
    deductionAwareSnapshot,
    exchangeOnlySnapshot,
  };
})(globalThis);
