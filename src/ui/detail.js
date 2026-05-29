/*
 * Detail panel boundary.
 *
 * Detail is where a selected candidate explains its bill composition,
 * deduction impact, resource usage, facility mix, splitter guide, and
 * endfield-calc export.  This module owns that future surface without tying it
 * to the current summary table implementation.
 */
(function () {
  let currentCandidate = null;
  let splitterMode = "nearest";
  let splitterOpen = false;

  function t(key, params = {}) {
    return globalThis.WulingI18n?.t?.(key, params) ?? key;
  }

  const {
    compactId,
    escapeHtml,
    facilityIconHtml,
    facilityMeta,
    fmtNumber,
    displayDigits,
    normalizeDisplayNumber,
    itemIconHtml,
    itemMeta,
    recipeById,
    recipeCountEntries,
    recipeList,
    scenario,
  } = globalThis.WulingDetailHelpers;

  function itemColor(itemId) {
    let hash = 0;
    const text = String(itemId || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return COMPOSITION_COLORS[Math.abs(hash) % COMPOSITION_COLORS.length];
  }

  function outputRatePerMinute(recipe, facilityCount, output) {
    const amount = Number(output?.amount) || 0;
    const seconds = Number(recipe?.craftingTime) || 1;
    return amount * 60 / seconds * facilityCount;
  }

  function ratePerUnit(recipe, itemId, direction = "output") {
    const entries = direction === "input" ? recipe?.inputs : recipe?.outputs;
    const entry = (entries || []).find((item) => item?.itemId === itemId);
    if (!entry) return 0;
    return outputRatePerMinute(recipe, 1, entry);
  }

  function facilityOutputSegments(candidate) {
    const result = candidate?.deductionResult ?? candidate?.exchangeResult;
    const byFacility = {};
    for (const [recipeId, rawCount] of recipeCountEntries(result)) {
      const facilityCount = Number(rawCount) || 0;
      if (facilityCount <= 1e-9) continue;
      const recipe = recipeById(result, recipeId);
      if (!recipe?.facilityId) continue;
      const output = (recipe.outputs || []).find((entry) => Number(entry?.amount) > 0);
      const itemId = output?.itemId || recipe.inputs?.[0]?.itemId || recipe.id;
      const key = itemId || recipeId;
      byFacility[recipe.facilityId] ??= {};
      const current = byFacility[recipe.facilityId][key] ?? {
        itemId,
        facilityUse: 0,
        outputRate: 0,
      };
      current.facilityUse += facilityCount;
      current.outputRate += output ? outputRatePerMinute(recipe, facilityCount, output) : 0;
      byFacility[recipe.facilityId][key] = current;
    }
    return Object.fromEntries(Object.entries(byFacility).map(([facilityId, segments]) => [
      facilityId,
      Object.values(segments).sort((a, b) => b.facilityUse - a.facilityUse || String(a.itemId).localeCompare(String(b.itemId))),
    ]));
  }

  function rawLimitMap(candidate) {
    return Object.fromEntries((candidate?.deductionSnapshot?.rawLimits
      ?? candidate?.exchangeSnapshot?.rawLimits
      ?? []).map((entry) => [entry.matId, Number(entry.cap) || 0]));
  }

  function rawLimitEntries(candidate) {
    return candidate?.deductionSnapshot?.rawLimits
      ?? candidate?.exchangeSnapshot?.rawLimits
      ?? [];
  }

  function facilityLimitMap(candidate) {
    return Object.fromEntries((candidate?.deductionSnapshot?.facilityLimits
      ?? candidate?.exchangeSnapshot?.facilityLimits
      ?? []).map((entry) => [entry.gameFacilityId ?? entry.id, Number(entry.cap) || 0]));
  }

  function rowsFromObject(map, unit = "") {
    return Object.entries(map || {})
      .filter(([, value]) => Math.abs(Number(value) || 0) > 1e-9)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, value]) => `
        <div class="wuling-detail-row">
          <span>${escapeHtml(compactId(id))}</span>
          <strong>${fmtNumber(value)}${unit}</strong>
        </div>
      `).join("");
  }

  function materialUsageSegments(candidate) {
    const result = candidate?.deductionResult ?? candidate?.exchangeResult;
    const visibleSharedItems = new Set([
      "item_liquid_sewage",
      "item_liquid_xiranite_poly",
    ]);
    const byItem = {};
    for (const [recipeId, rawCount] of recipeCountEntries(result)) {
      const facilityCount = Number(rawCount) || 0;
      if (facilityCount <= 1e-9) continue;
      const recipe = recipeById(result, recipeId);
      if (!recipe) continue;
      const output = (recipe.outputs || []).find((entry) => Number(entry?.amount) > 0);
      const purposeId = output?.itemId || `facility:${recipe.facilityId || "unknown"}`;
      for (const input of recipe.inputs || []) {
        if (!input?.itemId || !visibleSharedItems.has(input.itemId)) continue;
        const rate = outputRatePerMinute(recipe, facilityCount, input);
        if (rate <= 1e-9) continue;
        byItem[input.itemId] ??= {};
        const current = byItem[input.itemId][purposeId] ?? {
          purposeId,
          rate: 0,
        };
        current.rate += rate;
        byItem[input.itemId][purposeId] = current;
      }
    }
    return Object.entries(byItem)
      .map(([itemId, segmentMap]) => {
        const segments = Object.values(segmentMap)
          .filter((segment) => segment.rate > 1e-9)
          .sort((a, b) => b.rate - a.rate || String(a.purposeId).localeCompare(String(b.purposeId)));
        return {
          itemId,
          totalRate: segments.reduce((sum, segment) => sum + segment.rate, 0),
          segments,
        };
      })
      .filter((entry) => entry.segments.length > 0)
      .sort((a, b) => b.totalRate - a.totalRate || a.itemId.localeCompare(b.itemId))
      .slice(0, visibleSharedItems.size);
  }

  function purposeMeta(purposeId) {
    if (String(purposeId).startsWith("facility:")) {
      const meta = facilityMeta(String(purposeId).slice("facility:".length));
      return { name: meta.name, iconHtml: facilityIconHtml(meta.id) };
    }
    const meta = itemMeta(purposeId);
    return { name: meta.name, iconHtml: itemIconHtml(purposeId) };
  }

  const COMPOSITION_COLORS = [
    "#60a5fa",
    "#f97316",
    "#fb7185",
    "#8b5cf6",
    "#facc15",
    "#22c55e",
    "#38bdf8",
  ];

  function fractionalPart(value) {
    const n = Number(value) || 0;
    const frac = n - Math.floor(n);
    if (frac < 1e-6 || 1 - frac < 1e-6) return 0;
    return frac;
  }

  function splitterDepth(denominator) {
    let value = Number(denominator) || 1;
    let depth = 0;
    while (value > 1 && value % 3 === 0) {
      value /= 3;
      depth += 1;
    }
    while (value > 1 && value % 2 === 0) {
      value /= 2;
      depth += 1;
    }
    return value === 1 ? depth : Math.ceil(Math.log2(Math.max(2, denominator)));
  }

  function splitterRemainderBranches(denominator) {
    let value = Number(denominator) || 1;
    let branches = 0;
    while (value > 1 && value % 3 === 0) {
      value /= 3;
      branches += 2;
    }
    while (value > 1 && value % 2 === 0) {
      value /= 2;
      branches += 1;
    }
    if (value !== 1) return Math.max(1, Number(denominator) - 1);
    return branches;
  }

  function mergeCountForBranches(branches) {
    const branchesToReturn = Math.max(0, Number(branches) || 0);
    return Math.max(0, Math.ceil((branchesToReturn - 1) / 2));
  }

  function enrichFractionCandidate(entry, target) {
    const splitCount = entry.terms.reduce((sum, denominator) => sum + splitterDepth(denominator), 0);
    const remainderBranches = entry.terms.reduce((sum, denominator) => sum + splitterRemainderBranches(denominator), 0);
    return {
      ...entry,
      error: entry.value - target,
      absError: Math.abs(entry.value - target),
      splitCount,
      mergeCount: mergeCountForBranches(remainderBranches),
    };
  }

  function fractionCandidate(value, mode = "nearest") {
    const target = Math.max(0, Math.min(1, Number(value) || 0));
    const denominators = [2, 3, 4, 6, 8, 9, 12, 18, 27, 36];
    const candidates = [{ expression: "0", value: 0, terms: [], complement: false }];
    for (const a of denominators) {
      candidates.push({ expression: `1/${a}`, value: 1 / a, terms: [a], complement: false });
      candidates.push({ expression: `1 - (1/${a})`, value: 1 - (1 / a), terms: [a], complement: true });
      for (const b of denominators) {
        if (b < a) continue;
        const sum = (1 / a) + (1 / b);
        if (sum <= 1 + 1e-9) {
          candidates.push({ expression: `1/${a} + 1/${b}`, value: sum, terms: [a, b], complement: false });
        }
        const complement = 1 - sum;
        if (complement >= -1e-9) {
          candidates.push({ expression: `1 - (1/${a} + 1/${b})`, value: complement, terms: [a, b], complement: true });
        }
      }
    }
    const filtered = candidates
      .map((entry) => enrichFractionCandidate(entry, target))
      .filter((entry) => {
        if (mode === "over") return entry.error >= -1e-9;
        if (mode === "under") return entry.error <= 1e-9;
        return true;
      });
    const best = (filtered.length ? filtered : candidates.map((entry) => enrichFractionCandidate(entry, target)))
      .sort((a, b) => a.absError - b.absError || a.splitCount - b.splitCount || a.expression.length - b.expression.length)[0];
    if (best.value >= 1 - 1e-9 && best.absError <= 0.005) {
      return {
        expression: "-",
        error: best.error,
        splitCount: 0,
        mergeCount: 0,
      };
    }
    return {
      expression: best.expression,
      error: best.error,
      splitCount: best.splitCount,
      mergeCount: best.mergeCount,
    };
  }

  function activeRecipeOutputs(result) {
    const byItem = {};
    for (const [recipeId, rawCount] of recipeCountEntries(result)) {
      const facilityCount = Number(rawCount) || 0;
      if (facilityCount <= 1e-9) continue;
      const recipe = recipeById(result, recipeId);
      if (!recipe) continue;
      for (const output of recipe.outputs || []) {
        if (!output?.itemId || Number(output.amount) <= 0) continue;
        const outputRate = outputRatePerMinute(recipe, facilityCount, output);
        const entry = {
          recipe,
          recipeId,
          facilityId: recipe.facilityId,
          facilityCount,
          itemId: output.itemId,
          perUnitRate: ratePerUnit(recipe, output.itemId, "output"),
          outputRate,
        };
        byItem[output.itemId] ??= [];
        byItem[output.itemId].push(entry);
      }
    }
    for (const entries of Object.values(byItem)) {
      entries.sort((a, b) => b.outputRate - a.outputRate || a.recipeId.localeCompare(b.recipeId));
    }
    return byItem;
  }

  function splitterGuideRows(candidate) {
    const result = candidate?.exchangeResult;
    const billRows = (candidate?.summary?.billComposition ?? [])
      .filter((entry) => Number(entry.price || 0) > 1 && Number(entry.designRate || 0) > 1e-9)
      .sort((a, b) => (Number(b.price || 0) - Number(a.price || 0)) || a.itemId.localeCompare(b.itemId));
    const producers = activeRecipeOutputs(result);
    const rows = [];
    for (const billRow of billRows) {
      const parentProducer = producers[billRow.itemId]?.[0];
      if (!parentProducer?.perUnitRate) continue;
      const parentFacilityCount = Number(billRow.designRate || 0) / parentProducer.perUnitRate;
      if (!fractionalPart(parentFacilityCount)) continue;
      rows.push(splitterGuideRow({
        itemId: billRow.itemId,
        recipe: parentProducer.recipe,
        facilityId: parentProducer.facilityId,
        outputRate: Number(billRow.designRate || 0),
        perUnitRate: parentProducer.perUnitRate,
        facilityCount: parentFacilityCount,
        depth: 0,
      }));
      for (const input of parentProducer.recipe.inputs || []) {
        const childProducer = producers[input.itemId]?.[0];
        if (!childProducer?.perUnitRate) continue;
        const inputRate = ratePerUnit(parentProducer.recipe, input.itemId, "input") * parentFacilityCount;
        const childFacilityCount = inputRate / childProducer.perUnitRate;
        if (!fractionalPart(childFacilityCount)) continue;
        rows.push(splitterGuideRow({
          itemId: input.itemId,
          recipe: childProducer.recipe,
          facilityId: childProducer.facilityId,
          outputRate: inputRate,
          perUnitRate: childProducer.perUnitRate,
          facilityCount: childFacilityCount,
          depth: 1,
        }));
      }
    }
    return rows;
  }

  function splitterGuideRow({ itemId, recipe, facilityId, outputRate, perUnitRate, facilityCount, depth }) {
    const fraction = fractionCandidate(fractionalPart(facilityCount), splitterMode);
    return {
      itemId,
      recipeId: recipe?.id ?? "",
      facilityId,
      outputRate,
      perUnitRate,
      facilityCount,
      fraction,
      depth,
    };
  }

  function billCompositionHtml(candidate) {
    const rows = candidate?.summary?.billComposition ?? [];
    if (!rows.length) return `<div class="wuling-detail-empty">${escapeHtml(t("detail.bill.empty"))}</div>`;
    const total = rows.reduce((acc, entry) => ({
      designRate: acc.designRate + (Number(entry.designRate) || 0),
      directDeductionRate: acc.directDeductionRate + (Number(entry.directDeductionRate) || 0),
      solverAdjustmentRate: acc.solverAdjustmentRate + (Number(entry.solverAdjustmentRate) || 0),
      finalRate: acc.finalRate + (Number(entry.finalRate) || 0),
      finalBillsPerHour: acc.finalBillsPerHour + (Number(entry.finalBillsPerHour) || 0),
    }), {
      designRate: 0,
      directDeductionRate: 0,
      solverAdjustmentRate: 0,
      finalRate: 0,
      finalBillsPerHour: 0,
    });
    const positiveBillRows = rows.filter((entry) => Number(entry.finalBillsPerHour) > 0);
    const maxBill = Math.max(...positiveBillRows.map((entry) => Number(entry.finalBillsPerHour) || 0), 1);
    const barTotal = positiveBillRows.reduce((sum, entry) => sum + (Number(entry.finalBillsPerHour) || 0), 0);
    const stackBar = positiveBillRows.length
      ? `<div class="wuling-bill-stack" aria-label="Bill composition bar">
          ${positiveBillRows.map((entry, index) => {
            const width = Math.max(0.8, ((Number(entry.finalBillsPerHour) || 0) / barTotal) * 100);
            return `<span style="width:${width.toFixed(2)}%;background:${COMPOSITION_COLORS[index % COMPOSITION_COLORS.length]};"></span>`;
          }).join("")}
        </div>`
      : "";
    const rowHtml = (entry, index, className = "") => {
      const meta = itemMeta(entry.itemId);
      const isTotal = className.includes("is-total");
      const color = COMPOSITION_COLORS[index % COMPOSITION_COLORS.length];
      const designRate = Math.max(0, Number(entry.designRate) || 0);
      const directDeductionRate = Math.max(0, Number(entry.directDeductionRate) || 0);
      const solverAdjustmentRate = Number(entry.solverAdjustmentRate) || 0;
      const solverLossRate = Math.max(0, -solverAdjustmentRate);
      const solverGainRate = Math.max(0, solverAdjustmentRate);
      const finalRate = Math.max(0, Number(entry.finalRate) || 0);
      const barBasis = Math.max(designRate, finalRate + directDeductionRate + solverLossRate, 1);
      const segmentWidth = (value) => Math.max(value > 1e-9 ? 1.2 : 0, Math.min(100, (value / barBasis) * 100));
      const finalWidth = segmentWidth(Math.max(0, finalRate - solverGainRate));
      const gainWidth = segmentWidth(solverGainRate);
      const deductWidth = segmentWidth(directDeductionRate);
      const lossWidth = segmentWidth(solverLossRate);
      const billWidth = Math.min(100, Math.max(2, ((Number(entry.finalBillsPerHour) || 0) / maxBill) * 100));
      const barTitle = [
        `${t("detail.bill.final")}: ${fmtNumber(finalRate)}/m`,
        directDeductionRate ? `${t("detail.bill.deduct")}: -${fmtNumber(directDeductionRate)}/m` : null,
        solverAdjustmentRate ? `${t("detail.bill.header.adjust")}: ${solverAdjustmentRate > 0 ? "+" : ""}${fmtNumber(solverAdjustmentRate)}/m` : null,
        `Bill share: ${fmtNumber(Number(entry.finalBillsPerHour) || 0, 0)}/h`,
      ].filter(Boolean).join(" / ");
      return `
      <div class="wuling-detail-bill-table-row ${className}">
        <span class="wuling-bill-item">
          <i style="background:${color};"></i>
          ${entry.itemId ? itemIconHtml(entry.itemId) : ""}
          <span class="wuling-bill-item-body">
            <span class="wuling-bill-item-name">${entry.itemId ? escapeHtml(meta.name) : "Total"}</span>
            ${entry.itemId ? `<span class="wuling-bill-mini-bar" style="width:${billWidth.toFixed(2)}%;" title="${escapeHtml(barTitle)}">
              <span class="is-final" style="width:${finalWidth.toFixed(2)}%;"></span>
              ${gainWidth ? `<span class="is-gain" style="width:${gainWidth.toFixed(2)}%;"></span>` : ""}
              ${deductWidth ? `<span class="is-deduct" style="width:${deductWidth.toFixed(2)}%;"></span>` : ""}
              ${lossWidth ? `<span class="is-adjust-loss" style="width:${lossWidth.toFixed(2)}%;"></span>` : ""}
            </span>` : ""}
          </span>
        </span>
        <strong>${fmtNumber(entry.designRate)}/m</strong>
        <strong class="${entry.directDeductionRate ? "is-negative" : "is-muted"}">${entry.directDeductionRate ? `-${fmtNumber(entry.directDeductionRate)}/m` : "-"}</strong>
        <strong class="${entry.solverAdjustmentRate < 0 ? "is-negative" : entry.solverAdjustmentRate > 0 ? "is-positive" : "is-muted"}">${entry.solverAdjustmentRate ? `${entry.solverAdjustmentRate > 0 ? "+" : ""}${fmtNumber(entry.solverAdjustmentRate)}/m` : "-"}</strong>
        <strong>${fmtNumber(entry.finalRate)}/m</strong>
        <small class="${isTotal ? "wuling-bill-total-value" : ""}">
          <span>${fmtNumber(entry.finalBillsPerHour, 0)}/h</span>
          ${isTotal ? `<em>${fmtNumber((Number(entry.finalBillsPerHour) || 0) / 60, 0)}/m</em>` : ""}
        </small>
      </div>
    `;
    };
    return `
      <div class="wuling-detail-bill-summary">
        ${stackBar}
        <div class="wuling-bill-legend" aria-label="Bill composition bar legend">
          <span><i class="is-final"></i>${escapeHtml(t("detail.bill.final"))}</span>
          <span><i class="is-deduct"></i>${escapeHtml(t("detail.bill.deduct"))}</span>
          <span><i class="is-adjust-loss"></i>${escapeHtml(t("detail.bill.adjustLoss"))}</span>
          <span><i class="is-gain"></i>${escapeHtml(t("detail.bill.adjustGain"))}</span>
        </div>
      </div>
      <div class="wuling-detail-bill-table">
        <div class="wuling-detail-bill-table-head">
          <span>${escapeHtml(t("detail.bill.header.item"))}</span><span>${escapeHtml(t("detail.bill.header.design"))}</span><span>${escapeHtml(t("detail.bill.header.deduct"))}</span><span>${escapeHtml(t("detail.bill.header.adjust"))}</span><span>${escapeHtml(t("detail.bill.header.final"))}</span><span>${escapeHtml(t("detail.bill.header.bill"))}</span>
        </div>
        ${positiveBillRows.map((entry, index) => rowHtml(entry, index)).join("")}
        ${rowHtml(total, positiveBillRows.length, "is-total")}
      </div>
    `;
  }

  function endfieldCalcUrl(candidate) {
    return globalThis.WulingDetailExport?.endfieldCalcUrl?.(candidate) ?? "";
  }

  function openEndfieldCalc() {
    const url = endfieldCalcUrl(currentCandidate);
    if (!url) return;
    globalThis.open?.(url, "_blank", "noopener");
  }

  function resourceUsageHtml(candidate) {
    const rows = materialUsageSegments(candidate);
    if (!rows.length) return `<div class="wuling-detail-empty">No shared material usage.</div>`;
    return `
      <div class="wuling-usage-list">
        ${rows.map((row) => {
          const meta = itemMeta(row.itemId);
          return `
            <div class="wuling-resource-row is-stacked">
              <span class="wuling-usage-name">${itemIconHtml(row.itemId)}<strong>${escapeHtml(meta.name)}</strong></span>
              <span class="wuling-usage-track">
                ${row.segments.map((segment) => {
                  const width = Math.max(1.5, (segment.rate / Math.max(row.totalRate, 1)) * 100);
                  const purpose = purposeMeta(segment.purposeId);
                  const label = `${purpose.name}: ${fmtNumber(segment.rate, 1)}/m`;
                  return `<span title="${escapeHtml(label)}" style="width:${width.toFixed(2)}%;background:${itemColor(segment.purposeId)};"></span>`;
                }).join("")}
              </span>
              <span class="wuling-usage-value">${fmtNumber(row.totalRate, row.totalRate % 1 ? 1 : 0)}/m</span>
              <span class="wuling-material-segments">
                ${row.segments.slice(0, 4).map((segment) => {
                  const purpose = purposeMeta(segment.purposeId);
                  return `<span><i style="background:${itemColor(segment.purposeId)};"></i>${purpose.iconHtml}${escapeHtml(purpose.name)}</span>`;
                }).join("")}
              </span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function rawResourceUsageHtml(candidate) {
    const entries = rawLimitEntries(candidate);
    if (!entries.length) return `<div class="wuling-detail-empty">${escapeHtml(t("detail.usage.emptyRaw"))}</div>`;
    const rawUse = candidate?.summary?.rawUse ?? candidate?.deductionResult?.rawUse ?? candidate?.exchangeResult?.rawUse ?? {};
    return `
      <div class="wuling-usage-list">
        ${entries.map((entry) => {
          const itemId = entry.matId;
          const cap = Number(entry.cap) || 0;
          const used = Number(rawUse[itemId]) || 0;
          const percent = cap > 0 ? Math.min(100, Math.max(0, (used / cap) * 100)) : 0;
          const comparableUsed = normalizeDisplayNumber(used, 0.05);
          const comparableCap = normalizeDisplayNumber(cap, 0.05);
          const over = cap > 0 && comparableUsed > comparableCap + 1e-9;
          const under = cap > 0 && !over && comparableUsed < comparableCap - 1e-9;
          const meta = itemMeta(itemId);
          return `
            <div class="wuling-resource-row ${over ? "is-over" : under ? "is-under" : ""}">
              <span class="wuling-usage-name">${itemIconHtml(itemId)}<strong>${escapeHtml(meta.name)}</strong></span>
              <span class="wuling-usage-track" title="${escapeHtml(`${meta.name}: ${fmtNumber(used, displayDigits(used, 1))} / ${fmtNumber(cap, displayDigits(cap, 1))}`)}">
                <span class="${over ? "is-over" : under ? "is-under" : "is-capped"}" style="width:${percent.toFixed(2)}%;"></span>
              </span>
              <span class="wuling-usage-value">${fmtNumber(used, displayDigits(used, 1))} / ${fmtNumber(cap, displayDigits(cap, 1))}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function splitterGuideHtml(candidate) {
    const rows = splitterGuideRows(candidate);
    return `
      <details class="wuling-detail-card wuling-splitter-card is-wide" ${splitterOpen ? "open" : ""} ontoggle="globalThis.WulingDetailView?.setSplitterOpen?.(this.open)">
        <summary class="wuling-splitter-title">
          <h3>${escapeHtml(t("detail.splitter.title"))}</h3>
          <span class="wuling-splitter-mode" role="group" aria-label="${escapeHtml(t("detail.splitter.mode"))}">
            ${splitterModeButton("nearest", "±")}
            ${splitterModeButton("over", "+")}
            ${splitterModeButton("under", "-")}
          </span>
        </summary>
        ${rows.length ? `
          <div class="wuling-splitter-table">
            <div class="wuling-splitter-head">
              <span>${escapeHtml(t("detail.splitter.item"))}</span><span>${escapeHtml(t("detail.splitter.facility"))}</span><span>${escapeHtml(t("detail.splitter.output"))}</span><span>${escapeHtml(t("detail.splitter.perUnit"))}</span><span>${escapeHtml(t("detail.splitter.units"))}</span><span>${escapeHtml(t("detail.splitter.split"))}</span><span>${escapeHtml(t("detail.splitter.splitMerge"))}</span><span>${escapeHtml(t("detail.splitter.error"))}</span>
            </div>
            ${rows.map((row) => {
              const meta = itemMeta(row.itemId);
              const facility = facilityMeta(row.facilityId);
              return `
                <div class="wuling-splitter-row ${row.depth ? "is-child" : ""}">
                  <span class="wuling-splitter-item" title="${escapeHtml(meta.name)}">${row.depth ? "<em>└</em>" : ""}${itemIconHtml(row.itemId)}<strong>${escapeHtml(meta.name)}</strong></span>
                  <span title="${escapeHtml(facility.name)}">${facilityIconHtml(row.facilityId)}</span>
                  <span>${fmtNumber(row.outputRate, row.outputRate % 1 ? 2 : 0)}/m</span>
                  <span>${fmtNumber(row.perUnitRate, row.perUnitRate % 1 ? 2 : 0)}/m</span>
                  <span>${fmtNumber(row.facilityCount, 2)}u</span>
                  <span class="is-accent">${escapeHtml(row.fraction.expression)}</span>
                  <span>${row.fraction.splitCount || row.fraction.mergeCount ? `${row.fraction.splitCount} / ${row.fraction.mergeCount}` : "-"}</span>
                  <span>${fmtNumber(row.fraction.error, 4)}</span>
                </div>
              `;
            }).join("")}
          </div>
        ` : `<div class="wuling-detail-empty">${escapeHtml(t("detail.splitter.empty"))}</div>`}
      </details>
    `;
  }

  function splitterModeButton(value, label) {
    return `<button class="${splitterMode === value ? "is-active" : ""}" type="button" onclick="event.preventDefault(); event.stopPropagation(); globalThis.WulingDetailView?.setSplitterMode?.('${value}')" aria-pressed="${splitterMode === value ? "true" : "false"}">${label}</button>`;
  }

  function setSplitterMode(value) {
    if (!["nearest", "over", "under"].includes(value)) return;
    splitterMode = value;
    if (currentCandidate) {
      const container = document.getElementById("wuling-detail-root") ?? document.querySelector(".wuling-detail-view")?.parentElement;
      if (container) render(container, currentCandidate);
    }
  }

  function setSplitterOpen(value) {
    splitterOpen = !!value;
  }

  function facilityCardsHtml(candidate, entries) {
    const outputSegments = facilityOutputSegments(candidate);
    const caps = facilityLimitMap(candidate);
    const maxUse = Math.max(...entries.map(([, value]) => Number(value) || 0), 1);
    return entries.map(([id, value], index) => {
      const meta = facilityMeta(id);
      const used = Number(value) || 0;
      const cap = caps[id];
      const denominator = cap && cap > 0 ? cap : maxUse;
      const over = cap && used > cap + 1e-6;
      const segments = outputSegments[id] || [];
      const segmentTotal = segments.reduce((sum, segment) => sum + (Number(segment.facilityUse) || 0), 0);
      const fallbackColor = COMPOSITION_COLORS[index % COMPOSITION_COLORS.length];
      return `
        <div class="wuling-facility-card ${over ? "is-over" : ""}">
          <div class="wuling-facility-head">
            ${facilityIconHtml(id)}
            <strong>${escapeHtml(meta.name)}</strong>
            <span>${fmtNumber(used, 2)}u${cap != null ? ` / ${fmtNumber(cap, cap % 1 ? 1 : 0)}u` : ""}</span>
          </div>
          <div class="wuling-facility-track">
            ${segments.length ? segments.map((segment) => {
              const segmentWidth = Math.max(1.5, ((Number(segment.facilityUse) || 0) / Math.max(segmentTotal, 1e-9)) * 100);
              const segmentMeta = itemMeta(segment.itemId);
              const label = `${segmentMeta.name}: ${fmtNumber(segment.facilityUse, 2)}u${segment.outputRate ? ` / ${fmtNumber(segment.outputRate, 1)}/m` : ""}`;
              return `<span title="${escapeHtml(label)}" style="width:${segmentWidth.toFixed(2)}%;background:${itemColor(segment.itemId)};"></span>`;
            }).join("") : `<span style="width:100%;background:${fallbackColor};"></span>`}
          </div>
          ${segments.length > 1 ? `<div class="wuling-facility-segments">
            ${segments.slice(0, 4).map((segment) => {
              const segmentMeta = itemMeta(segment.itemId);
              return `<span><i style="background:${itemColor(segment.itemId)};"></i>${escapeHtml(segmentMeta.name)}</span>`;
            }).join("")}
          </div>` : ""}
        </div>
      `;
    }).join("");
  }

  function constrainedFacilityUsageHtml(candidate) {
    const facUse = candidate?.summary?.facUse ?? {};
    const caps = facilityLimitMap(candidate);
    const entries = Object.keys(caps)
      .map((id) => [id, Number(facUse[id]) || 0])
      .filter(([, value]) => Math.abs(Number(value) || 0) > 1e-9)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return "";
    return `<div class="wuling-facility-grid is-constrained">${facilityCardsHtml(candidate, entries)}</div>`;
  }

  function facilityUsageHtml(candidate) {
    const facUse = candidate?.summary?.facUse ?? {};
    const entries = Object.entries(facUse)
      .filter(([, value]) => Math.abs(Number(value) || 0) > 1e-9)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return `<div class="wuling-detail-empty">${escapeHtml(t("detail.usage.noFacilities"))}</div>`;
    return `<div class="wuling-facility-grid">${facilityCardsHtml(candidate, entries)}</div>`;
  }

  function usageHtml(candidate) {
    return `
      <div class="wuling-detail-card is-wide wuling-usage-card">
        <h3>${escapeHtml(t("panel.resourceFacilityUsage"))}</h3>
        ${rawResourceUsageHtml(candidate)}
        ${resourceUsageHtml(candidate)}
        ${constrainedFacilityUsageHtml(candidate)}
        <h4>${escapeHtml(t("detail.usage.facilities"))}</h4>
        ${facilityUsageHtml(candidate)}
      </div>
    `;
  }

  function render(container, candidate = null) {
    if (!container) return;
    currentCandidate = candidate;
    const summary = candidate?.summary ?? null;
    const title = candidate?.policy?.label ?? candidate?.policy?.id ?? t("detail.noCandidate");
    const calcUrl = candidate ? endfieldCalcUrl(candidate) : "";
    container.innerHTML = `
      <section class="wuling-detail-view">
        <header class="wuling-view-head">
          <h2>${escapeHtml(t("detail.title"))}</h2>
          <span class="wuling-detail-subtitle">${candidate ? `${escapeHtml(title)} / ${escapeHtml(candidate.variant?.label ?? "")}` : escapeHtml(title)}</span>
          ${candidate ? `<span class="wuling-detail-actions">
            <button class="wuling-detail-apply" type="button" onclick="globalThis.WulingCandidateController?.applyCandidate?.()" aria-label="${escapeHtml(t("detail.apply"))}" title="${escapeHtml(t("detail.apply"))}">↩</button>
            ${calcUrl ? `<button class="wuling-detail-calc" type="button" onclick="globalThis.WulingDetailView?.openEndfieldCalc?.()" aria-label="${escapeHtml(t("detail.openEndfieldCalc"))}">${escapeHtml(t("detail.openEndfieldCalc"))}</button>` : ""}
            <button class="wuling-detail-close" type="button" onclick="globalThis.WulingCandidateController?.closeDetail?.()" aria-label="${escapeHtml(t("detail.close"))}" title="${escapeHtml(t("detail.close"))}">×</button>
          </span>` : ""}
        </header>
        ${candidate
          ? `<div class="wuling-detail-grid">
              <div class="wuling-detail-card is-wide">
                <h3>${escapeHtml(t("detail.billComposition"))}</h3>
                ${billCompositionHtml(candidate)}
              </div>
              ${splitterGuideHtml(candidate)}
              ${usageHtml(candidate)}
            </div>`
          : `<div class="wuling-detail-empty">${escapeHtml(t("detail.empty"))}</div>`}
      </section>
    `;
  }

  globalThis.WulingDetailView = {
    endfieldCalcTargets: (candidate) => globalThis.WulingDetailExport?.endfieldCalcTargets?.(candidate) ?? [],
    endfieldCalcUrl,
    openEndfieldCalc,
    render,
    setSplitterMode,
    setSplitterOpen,
  };
})();
