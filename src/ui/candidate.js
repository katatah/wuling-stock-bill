/*
 * Candidate panel boundary.
 *
 * Candidate generation is expected to become Wuling-specific: power-focused
 * plans, practical integer variants, resource boosts, and deduction-aware
 * comparison.  Keep list rendering behind this module so app.js can stay an
 * event router when the UI is replaced.
 */
(function () {
  let billGapTarget = null;

  function t(key, params = {}) {
    return globalThis.WulingI18n?.t?.(key, params) ?? key;
  }

  function normalizeCandidates(candidates) {
    if (globalThis.WulingCandidateEngine?.candidateRows) {
      return globalThis.WulingCandidateEngine.candidateRows(candidates);
    }
    return (Array.isArray(candidates) ? candidates.filter(Boolean) : []).map((candidate, index) => ({
      index: index + 1,
      id: candidate.id ?? String(index + 1),
      policyLabel: candidate.policy?.label ?? candidate.policyId ?? "",
      variantLabel: candidate.variant?.label ?? "",
      billsPerHour: candidate.summary?.deductionBillsPerHour ?? candidate.deductionBillsPerHour ?? 0,
      gapToMaxBillsPerHour: candidate.summary?.gapToMaxBillsPerHour ?? 0,
      status: candidate.summary?.deductionStatus ?? candidate.deductionResult?.status ?? "",
      candidate,
    }));
  }

  function fmtNumber(value, digits = 0) {
    const n = normalizeDisplayNumber(value);
    return n.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function normalizeDisplayNumber(value, epsilon = 1e-6) {
    const n = Number(value) || 0;
    const rounded = Math.round(n);
    return Math.abs(n - rounded) < epsilon ? rounded : n;
  }

  function displayDigits(value, fractionalDigits = 1) {
    return Math.abs(normalizeDisplayNumber(value) % 1) > 1e-9 ? fractionalDigits : 0;
  }

  function parseNumberInput(value) {
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function itemMeta(itemId) {
    const item = (globalThis.ITEMS_DB || []).find((entry) => entry?.id === itemId);
    const fallbackName = item?.name || String(itemId || "").replace(/^item_/, "").replace(/_/g, " ");
    return {
      iconFile: item?.iconFile || "",
      name: globalThis.WulingCatalogLabels?.itemName?.(item || itemId, fallbackName) || fallbackName,
    };
  }

  function itemIcon(itemId) {
    const meta = itemMeta(itemId);
    return meta.iconFile
      ? `<img src="assets/icons/items/${escapeHtml(meta.iconFile)}" class="mat-icon" alt="">`
      : "";
  }

  function candidateScenario() {
    return globalThis.WulingSolverService?.getScenario?.() ?? globalThis.WULING_STOCK_BILL_SCENARIO ?? null;
  }

  function gapTarget() {
    if (billGapTarget != null) return billGapTarget;
    return Number(candidateScenario()?.maxBillsPerHour) || 0;
  }

  function setGapTarget(value) {
    billGapTarget = parseNumberInput(value);
    globalThis.WulingCandidateController?.render?.();
  }

  function rawLimitMap(candidate) {
    return Object.fromEntries((candidate?.deductionSnapshot?.rawLimits
      ?? candidate?.exchangeSnapshot?.rawLimits
      ?? []).map((entry) => [entry.matId, Number(entry.cap) || 0]));
  }

  function tradeOutputColumns() {
    const scenario = candidateScenario();
    const snapshot = globalThis.WulingSolverService?.getCurrentSnapshot?.();
    const tradeIds = new Set((scenario?.tradeItems ?? []).map((entry) => entry.itemId));
    const productionIds = (snapshot?.production ?? [])
      .map((entry) => entry.id)
      .filter((id) => tradeIds.has(id));
    if (productionIds.length) return productionIds;
    return (scenario?.tradeItems ?? [])
      .filter((entry) => entry?.defaultTarget !== false)
      .map((entry) => entry.itemId);
  }

  function resourceColumns() {
    const scenario = candidateScenario();
    return (scenario?.constrainedResources ?? []).map((entry) => entry.itemId);
  }

  function compositionMap(row) {
    return Object.fromEntries((row.summary?.billComposition ?? row.candidate?.summary?.billComposition ?? [])
      .map((entry) => [entry.itemId, entry]));
  }

  function outputCell(row, itemId) {
    const entry = compositionMap(row)[itemId];
    const designRate = Number(entry?.designRate ?? entry?.finalRate) || 0;
    const finalRate = Number(entry?.finalRate) || 0;
    const delta = finalRate - designRate;
    const hasDelta = Math.abs(delta) > 0.005;
    const digits = designRate % 1 ? 2 : 0;
    return `
      <span class="candidate-output ${designRate ? "" : "is-zero"}" title="${hasDelta ? `${t("candidate.afterDeductions")}: ${fmtNumber(finalRate, finalRate % 1 ? 2 : 0)}/m` : ""}">
        <strong>${designRate ? fmtNumber(designRate, digits) : "0"}</strong>
        ${hasDelta ? `<small class="${delta < 0 ? "is-negative" : "is-positive"}">${delta > 0 ? "+" : ""}${fmtNumber(delta, Math.abs(delta) % 1 ? 2 : 0)}</small>` : ""}
      </span>
    `;
  }

  function resourceCell(row, itemId) {
    const candidate = row.candidate ?? {};
    const summary = row.summary ?? candidate.summary ?? {};
    const used = Number(summary.rawUse?.[itemId]) || 0;
    const cap = rawLimitMap(candidate)[itemId];
    const comparableUsed = normalizeDisplayNumber(used, 0.05);
    const comparableCap = normalizeDisplayNumber(cap, 0.05);
    const over = cap != null && cap > 0 && comparableUsed > comparableCap + 1e-9;
    const under = cap != null && cap > 0 && !over && comparableUsed < comparableCap - 1e-9;
    const digits = displayDigits(used, 1);
    return `
      <span class="candidate-resource ${over ? "is-over" : under ? "is-under" : ""}">
        <strong>${fmtNumber(used, digits)}</strong>
        ${cap != null ? `<small>/ ${fmtNumber(cap, displayDigits(cap, 1))}</small>` : ""}
      </span>
    `;
  }

  function boostCell(row) {
    const boost = row.candidate?.variant?.boost;
    if (!boost?.itemId || !boost?.amount) {
      return `<span class="candidate-boost is-empty">-</span>`;
    }
    const meta = itemMeta(boost.itemId);
    return `
      <span class="candidate-boost" title="Metastorage Transfer: ${escapeHtml(meta.name)} +${fmtNumber(boost.amount)}">
        ${itemIcon(boost.itemId)}
        <strong>+${fmtNumber(boost.amount)}</strong>
      </span>
    `;
  }

  function columnHeader(itemId) {
    const meta = itemMeta(itemId);
    return `<span class="candidate-icon-head" title="${escapeHtml(meta.name)}">${itemIcon(itemId)}</span>`;
  }

  function rowHtml(row, state = {}, outputIds = [], resourceIds = []) {
    const targetGap = row.billsPerHour - gapTarget();
    const gapClass = targetGap >= 0 ? "is-positive" : "is-negative";
    const selected = row.id === state.selectedId;
    const isProductionSelection = row.policyId === "selected" || row.candidate?.policy?.id === "selected";
    return `
      <button class="wuling-candidate-row ${selected ? "is-selected" : ""} ${isProductionSelection ? "is-production-selection" : ""}" type="button" data-candidate-id="${row.id}" aria-pressed="${selected ? "true" : "false"}" onclick="globalThis.WulingCandidateController?.select?.('${row.id}')" ondblclick="globalThis.WulingCandidateController?.applyCandidate?.('${row.id}')" title="${escapeHtml(t("candidate.applyTitle"))}">
        <span class="candidate-marker-cell">${isProductionSelection ? `<i class="candidate-production-mark" title="${escapeHtml(t("candidate.productionSelection"))}" aria-label="${escapeHtml(t("candidate.productionSelection"))}">◆</i>` : ""}</span>
        <span class="candidate-bills">
          <strong>${fmtNumber(row.billsPerHour)}</strong>
          <small>${fmtNumber(row.billsPerHour / 60)}/m</small>
        </span>
        <span class="candidate-gap ${gapClass}">${targetGap >= 0 ? "+" : ""}${fmtNumber(targetGap)}</span>
        ${outputIds.map((itemId) => outputCell(row, itemId)).join("")}
        ${boostCell(row)}
        ${resourceIds.map((itemId) => resourceCell(row, itemId)).join("")}
      </button>
    `;
  }

  function render(container, candidates = [], state = {}) {
    if (!container) return;
    const rows = normalizeCandidates(candidates);
    const outputIds = tradeOutputColumns();
    const resourceIds = resourceColumns();
    const gridTemplate = [
      "1rem",
      "minmax(4.25rem, 0.42fr)",
      "minmax(2.9rem, 0.26fr)",
      ...outputIds.map(() => "minmax(3.45rem, 0.34fr)"),
      "minmax(3rem, 0.26fr)",
      ...resourceIds.map(() => "minmax(4.25rem, 0.42fr)"),
    ].join(" ");
    const statusText = state.error
      ? state.error
        : state.busy
          ? t("candidate.status.generating")
        : rows.length
          ? [
            t("candidate.status.rows", { rows: rows.length }),
            state.attemptedCount != null ? t("candidate.status.tried", { tried: fmtNumber(state.attemptedCount) }) : null,
            state.elapsedMs != null ? t("candidate.status.ms", { ms: fmtNumber(state.elapsedMs) }) : null,
          ].filter(Boolean).join(" / ")
          : t("candidate.status.notGenerated");
    container.innerHTML = `
      <section class="wuling-candidate-view">
        <header class="wuling-view-head">
          <h2>${escapeHtml(t("candidate.title"))}</h2>
          <div class="wuling-candidate-actions">
            <span class="${state.error ? "is-negative" : ""}">${statusText}</span>
          </div>
        </header>
        ${rows.length
          ? `<div class="wuling-candidate-table" style="--candidate-grid:${gridTemplate};">
              <div class="wuling-candidate-head">
                <span></span>
                <span>${escapeHtml(t("candidate.header.bills"))}</span>
                <span class="candidate-gap-target-head">
                  <span class="candidate-gap-target-prefix">-</span>
                  <input type="text" inputmode="numeric" value="${fmtNumber(gapTarget())}" aria-label="Target Wuling Stock Bill per hour" onchange="globalThis.WulingCandidateView?.setGapTarget?.(this.value)" onkeydown="if(event.key==='Enter')this.blur()">
                </span>
                ${outputIds.map(columnHeader).join("")}<span class="candidate-boost-head" title="Metastorage Transfer">${escapeHtml(t("candidate.header.transfer"))}</span>${resourceIds.map(columnHeader).join("")}
              </div>
              ${rows.map((row) => rowHtml(row, state, outputIds, resourceIds)).join("")}
            </div>`
          : `<div class="wuling-candidate-empty">${escapeHtml(t("candidate.empty"))}</div>`}
      </section>
    `;
  }

  globalThis.WulingCandidateView = {
    normalizeCandidates,
    render,
    setGapTarget,
  };
})();
