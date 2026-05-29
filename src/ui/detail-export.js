/*
 * External links from the selected-candidate detail panel.
 */
(function () {
  const ENDFIELD_CALC_BASE_URL = "https://jambochen.github.io/endfield-calc/";

  function scenario() {
    return globalThis.WULING_STOCK_BILL_SCENARIO ?? null;
  }

  function endfieldCalcTargets(candidate) {
    const currentScenario = scenario();
    const tradeItems = currentScenario?.tradeItems ?? [];
    const tradeIds = new Set(tradeItems.map((entry) => entry.itemId));
    const targets = new Map();
    const designRates = globalThis.WulingSolutionSummary?.positiveTradeRates
      ? globalThis.WulingSolutionSummary.positiveTradeRates(candidate?.exchangeResult, currentScenario)
      : {};
    for (const tradeItem of tradeItems) {
      const rate = Number(designRates[tradeItem.itemId]) || 0;
      if (rate > 1e-7) targets.set(tradeItem.itemId, (targets.get(tradeItem.itemId) ?? 0) + rate);
    }
    const deductionRates = globalThis.WulingDeductions?.deductionRateMap?.(candidate?.deductionSnapshot, currentScenario) ?? {};
    for (const [itemId, rate] of Object.entries(deductionRates)) {
      if (tradeIds.has(itemId)) continue;
      const numericRate = Number(rate) || 0;
      if (numericRate > 1e-7) targets.set(itemId, (targets.get(itemId) ?? 0) + numericRate);
    }
    return [...targets.entries()]
      .map(([itemId, rate]) => ({ itemId, rate }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));
  }

  function formatEndfieldCalcRate(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "0";
    return Number(number.toFixed(6)).toString();
  }

  function endfieldCalcUrl(candidate) {
    const targets = endfieldCalcTargets(candidate);
    if (!targets.length) return "";
    const url = new URL(ENDFIELD_CALC_BASE_URL);
    const params = new URLSearchParams();
    params.set("t", targets.map((target) => `${target.itemId}:${formatEndfieldCalcRate(target.rate)}`).join(","));
    params.set("c", "1");
    url.hash = params.toString();
    return url.toString();
  }

  globalThis.WulingDetailExport = {
    endfieldCalcTargets,
    endfieldCalcUrl,
  };
})();
