/*
 * Candidate controller.
 *
 * This is intentionally small: it wires the current scenario snapshot to the
 * candidate engine and keeps the generated rows out of the legacy app globals.
 */
(function () {
  let latestCandidates = [];
  let latestState = {};
  let latestNearbyDebug = null;
  let selectedId = null;
  let generateTimer = null;
  let lastGeneratedSignature = "";
  let suppressNextAutoSelect = false;

  function root() {
    return document.getElementById("wuling-candidate-root");
  }

  function render(candidates = latestCandidates, state = latestState) {
    latestCandidates = Array.isArray(candidates) ? candidates : [];
    latestState = state || {};
    const visible = visibleCandidates(latestCandidates);
    if (selectedId && !visible.some((candidate) => candidate?.id === selectedId)) selectedId = null;
    globalThis.WulingCandidateView?.render?.(root(), visible, {
      ...latestState,
      selectedId,
    });
    renderDetail(selectedCandidate());
  }

  function generate() {
    const service = globalThis.WulingSolverService;
    const engine = globalThis.WulingCandidateEngine;
    const scenario = service?.getScenario?.();
    const snapshot = service?.getCurrentSnapshot?.();
    if (!service || !engine || !scenario || !snapshot) {
      render(latestCandidates, { error: "candidate service unavailable" });
      return [];
    }

    const signature = snapshotSignature(snapshot);
    if (signature && signature === lastGeneratedSignature && latestCandidates.length && !latestState.error) {
      render(latestCandidates, latestState);
      return latestCandidates;
    }

    render(latestCandidates, { busy: true });
    const start = performance.now();
    try {
      const solveCandidates = engine.solveCombinedCandidateSet ?? engine.solveCandidateSet;
      const candidates = solveCandidates(snapshot, scenario, {
        solveSnapshot: service.solveSnapshot,
      });
      const elapsedMs = performance.now() - start;
      lastGeneratedSignature = signature;
      const visible = visibleCandidates(candidates);
      logCandidateDrops(candidates, visible);
      logNearbyCandidates(candidates);
      selectedId = suppressNextAutoSelect ? null : (preferredAutoSelection(visible)?.id ?? null);
      suppressNextAutoSelect = false;
      render(candidates, { elapsedMs, attemptedCount: candidates.length });
      return candidates;
    } catch (error) {
      console.error("[wuling-candidates] generation failed", error);
      render(latestCandidates, { error: error?.message || "candidate generation failed" });
      return [];
    }
  }

  function clear() {
    selectedId = null;
    lastGeneratedSignature = "";
    render([], {});
  }

  function snapshotSignature(snapshot) {
    try {
      return JSON.stringify({
        production: snapshot?.production ?? [],
        rawLimits: snapshot?.rawLimits ?? [],
        facilityLimits: snapshot?.facilityLimits ?? [],
        powerBatteries: snapshot?.powerBatteries ?? [],
        prices: snapshot?.prices ?? {},
        recipeOptions: snapshot?.recipeOptions ?? {},
        prioritizeUnsellable: !!snapshot?.prioritizeUnsellable,
        selectedResourceBoostId: snapshot?.selectedResourceBoostId ?? "",
      });
    } catch (_error) {
      return "";
    }
  }

  function scheduleGenerate(delayMs = 250) {
    if (generateTimer) clearTimeout(generateTimer);
    generateTimer = setTimeout(() => {
      generateTimer = null;
      generate();
    }, delayMs);
  }

  function selectedCandidate() {
    if (!selectedId) return null;
    return visibleCandidates(latestCandidates).find((candidate) => candidate?.id === selectedId) ?? null;
  }

  function visibleCandidates(candidates) {
    const rows = Array.isArray(candidates) ? candidates : [];
    return globalThis.WulingCandidateEngine?.orderCandidateResults?.(rows) ?? rows;
  }

  function preferredAutoSelection(visible) {
    const rows = Array.isArray(visible) ? visible : [];
    return rows.find((candidate) => candidate?.policy?.id === "selected") ?? rows[0] ?? null;
  }

  function logCandidateDrops(candidates, visible) {
    if (typeof window === "undefined") return;
    const all = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const visibleIds = new Set((visible ?? []).map((candidate) => candidate?.id));
    const dropped = all.filter((candidate) => !visibleIds.has(candidate?.id));
    if (!dropped.length) return;
    const summary = dropped.map((candidate) => ({
      id: candidate?.id,
      policy: candidate?.policy?.id ?? "",
      variant: candidate?.variant?.id ?? "",
      exchange: candidate?.exchangeResult?.status ?? "missing",
      exchangeReason: resultReason(candidate?.exchangeResult),
      deduction: candidate?.deductionResult?.status ?? "missing",
      deductionReason: resultReason(candidate?.deductionResult),
      bills: Math.round(candidate?.summary?.deductionBillsPerHour ?? candidate?.deductionBillsPerHour ?? 0),
      exchangeTargets: productionSummary(candidate?.exchangeSnapshot),
      deductionTargets: productionSummary(candidate?.deductionSnapshot),
      exchangeCaps: rawLimitSummary(candidate?.exchangeSnapshot),
      rawCaps: rawLimitSummary(candidate?.deductionSnapshot),
      facilityCaps: facilityLimitSummary(candidate?.deductionSnapshot),
      exchangeStats: resultStats(candidate?.exchangeResult),
      deductionStats: resultStats(candidate?.deductionResult),
    }));
    console.debug("[wuling-candidates] hidden candidates", {
      tried: all.length,
      visible: visible?.length ?? 0,
      hidden: dropped.length,
      summary,
    });
  }

  function logNearbyCandidates(candidates) {
    if (typeof window === "undefined") return;
    const nearby = (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => candidate?.policy?.id === "nearby");
    if (!nearby.length) {
      latestNearbyDebug = null;
      return;
    }
    const summary = nearby.map((candidate) => {
      const source = candidate?.variant?.source ?? candidate?.policy?.source ?? {};
      const fixedRates = (source.fixedRates ?? []).map((entry) => ({
        item: entry.itemId,
        sourceFacility: roundDebug(entry.sourceFacilityCount),
        targetFacility: roundDebug(entry.targetFacilityCount),
        sourceRate: roundDebug(entry.sourceRate),
        targetRate: roundDebug(entry.targetRate ?? entry.rate),
      }));
      const singleFixed = !fixedRates.length && source.itemId
        ? [{
          item: source.itemId,
          sourceRate: roundDebug(source.sourceRate),
          targetRate: roundDebug(source.targetRate),
        }]
        : [];
      const locks = fixedRates.length ? fixedRates : singleFixed;
      return {
        id: candidate?.id,
        variant: candidate?.variant?.id ?? "",
        boost: boostSummary(candidate?.variant?.boost),
        conditionKey: [
          boostSummary(candidate?.variant?.boost),
          ...locks.map((entry) => `${entry.item}:${entry.targetFacility ?? ""}:${entry.targetRate}`),
        ].join("|"),
        locks,
        exchange: candidate?.exchangeResult?.status ?? "missing",
        deduction: candidate?.deductionResult?.status ?? "missing",
        exchangeRates: tradeRateSummary(candidate?.exchangeResult),
        finalRates: billCompositionSummary(candidate),
        bills: roundDebug(candidate?.summary?.deductionBillsPerHour ?? candidate?.deductionBillsPerHour),
      };
    });
    latestNearbyDebug = {
      count: nearby.length,
      uniqueConditions: new Set(summary.map((entry) => entry.conditionKey)).size,
      uniqueFinals: new Set(summary.map((entry) => finalKey(entry.finalRates, entry.boost))).size,
      duplicateConditions: duplicateKeys(summary.map((entry) => entry.conditionKey)),
      duplicateFinals: duplicateKeys(summary.map((entry) => finalKey(entry.finalRates, entry.boost))),
      summary,
    };
    console.debug("[wuling-candidates] nearby variants", latestNearbyDebug);
  }

  function resultReason(result) {
    if (!result) return "";
    if (result.violation) return result.violation;
    if (result.reason) return result.reason;
    if (result.error) return result.error;
    const raw = result.raw ?? result;
    if (raw?.violation) return raw.violation;
    if (raw?.reason) return raw.reason;
    if (raw?.error) return raw.error;
    const solverResult = raw?.result ?? result.result;
    return solverResult?.Status ?? solverResult?.status ?? "";
  }

  function resultStats(result) {
    const raw = result?.raw ?? result;
    const model = raw?.model ?? result?.model;
    const graph = raw?.graph ?? result?.graph;
    const timings = raw?.timings ?? result?.timings ?? {};
    return {
      constraints: model?.constraints ? Object.keys(model.constraints).length : 0,
      variables: model?.variables ? Object.keys(model.variables).length : 0,
      recipes: graph?.recipeNodes?.size ?? raw?.graphRecipeCount ?? result?.graphRecipeCount ?? 0,
      items: graph?.itemNodes?.size ?? raw?.graphItemCount ?? result?.graphItemCount ?? 0,
      timings,
    };
  }

  function productionSummary(snapshot) {
    return (snapshot?.production ?? [])
      .filter((entry) => Math.abs(Number(entry.rate) || 0) > 1e-9)
      .map((entry) => ({
        id: entry.id,
        rate: Number(entry.rate) || 0,
        maxRate: Number(entry.maxRate) || 0,
        locked: !!entry.locked,
      }));
  }

  function rawLimitSummary(snapshot) {
    return Object.fromEntries((snapshot?.rawLimits ?? [])
      .map((entry) => [entry.matId, Number(entry.cap) || 0]));
  }

  function facilityLimitSummary(snapshot) {
    return Object.fromEntries((snapshot?.facilityLimits ?? [])
      .map((entry) => [entry.gameFacilityId ?? entry.id, Number(entry.cap) || 0]));
  }

  function tradeRateSummary(result) {
    const rates = result?.netRates ?? result?.raw?.netRates ?? {};
    const scenario = globalThis.WulingSolverService?.getScenario?.();
    const tradeIds = new Set((scenario?.tradeItems ?? []).map((entry) => entry.itemId));
    return Object.fromEntries(Object.entries(rates)
      .filter(([itemId, value]) => tradeIds.has(itemId) && Math.abs(Number(value) || 0) > 1e-9)
      .map(([itemId, value]) => [itemId, roundDebug(value)]));
  }

  function billCompositionSummary(candidate) {
    return Object.fromEntries((candidate?.summary?.billComposition ?? [])
      .filter((entry) => Math.abs(Number(entry.finalRate ?? entry.designRate) || 0) > 1e-9)
      .map((entry) => [entry.itemId, {
        design: roundDebug(entry.designRate),
        deduct: roundDebug(entry.directDeductionRate),
        adjust: roundDebug(entry.adjustmentRate),
        final: roundDebug(entry.finalRate),
      }]));
  }

  function boostSummary(boost) {
    return boost?.itemId ? `${boost.itemId}+${Number(boost.amount || 0)}` : "base";
  }

  function finalKey(finalRates, boost) {
    return [
      boost,
      ...Object.entries(finalRates ?? {})
        .map(([itemId, entry]) => `${itemId}:${roundDebug(entry.final)}`)
        .sort(),
    ].join("|");
  }

  function duplicateKeys(keys) {
    const counts = new Map();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));
  }

  function roundDebug(value) {
    const number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.round(number * 1000000) / 1000000;
  }

  function renderDetail(candidate) {
    const container = document.getElementById("wuling-detail-root");
    const app = typeof document.querySelector === "function" ? document.querySelector(".app") : null;
    app?.classList?.toggle?.("detail-open", !!candidate);
    globalThis.WulingDetailView?.render?.(container, candidate);
  }

  function select(id) {
    selectedId = id;
    render(latestCandidates, latestState);
    return selectedCandidate();
  }

  function closeDetail() {
    selectedId = null;
    render(latestCandidates, latestState);
  }

  function candidateById(id) {
    return (Array.isArray(latestCandidates) ? latestCandidates : [])
      .find((candidate) => candidate?.id === id) ?? null;
  }

  function applyCandidate(id) {
    const candidate = id ? candidateById(id) : selectedCandidate();
    if (!candidate) return false;
    const plan = globalThis.WulingCandidateApply?.candidateApplyPlan?.(candidate);
    if (!plan?.production?.length) return false;
    const applied = globalThis.WulingAppState?.applyProductionPlan?.(plan);
    if (!applied) return false;
    suppressNextAutoSelect = true;
    selectedId = null;
    latestCandidates = [];
    latestState = {};
    lastGeneratedSignature = "";
    render([], {});
    scheduleGenerate(350);
    return true;
  }

  globalThis.WulingI18n?.onChange?.(() => {
    render(latestCandidates, latestState);
  });

  globalThis.WulingCandidateController = {
    applyCandidate,
    clear,
    closeDetail,
    generate,
    render,
    scheduleGenerate,
    select,
    selectedCandidate,
    nearbyDebug: () => latestNearbyDebug,
    snapshotSignature,
  };
})();
