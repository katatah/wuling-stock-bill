/*
 * Shared helpers for the selected-candidate detail panel.
 *
 * Keep these small and presentation-focused.  Scenario solving and candidate
 * generation should stay in src/scenario.
 */
(function () {
  function compactId(id) {
    return String(id || "").replace(/^item_/, "").replace(/^fac_/, "").replace(/_/g, " ");
  }

  function fmtNumber(value, digits = 2) {
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function escapeJsString(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function itemMeta(itemId) {
    const item = (globalThis.ITEMS_DB || []).find((entry) => entry?.id === itemId);
    const fallbackName = item?.name || compactId(itemId);
    return {
      iconFile: item?.iconFile || "",
      name: globalThis.WulingCatalogLabels?.itemName?.(item || itemId, fallbackName) || fallbackName,
    };
  }

  function itemByIconFile(iconFile) {
    const file = String(iconFile || "").split(/[\\/]/).pop();
    if (!file) return null;
    return (globalThis.ITEMS_DB || []).find((entry) => entry?.iconFile === file) || null;
  }

  function itemIconHtml(itemId) {
    const meta = itemMeta(itemId);
    return meta.iconFile
      ? `<span class="wuling-item-icon-tip" data-item-id="${escapeHtml(itemId)}" onmouseenter="globalThis.WulingDetailHelpers?.showItemRecipeTooltip?.(this, '${escapeJsString(itemId)}')" onmouseleave="globalThis.WulingDetailHelpers?.hideItemRecipeTooltip?.()"><img src="assets/icons/items/${escapeHtml(meta.iconFile)}" class="mat-icon" alt=""></span>`
      : "";
  }

  function rawItemIconHtml(itemId) {
    const meta = itemMeta(itemId);
    return meta.iconFile
      ? `<img src="assets/icons/items/${escapeHtml(meta.iconFile)}" class="mat-icon" alt="">`
      : "";
  }

  function rawFacilityIconHtml(facilityId) {
    return `<img src="assets/icons/facilities/${escapeHtml(facilityId)}.webp" class="mat-icon" alt="">`;
  }

  function facilityMeta(facilityId) {
    const facility = (globalThis.RECIPES_DB?.facilities || []).find((entry) => entry?.id === facilityId);
    const fallbackName = facility?.name || compactId(facilityId);
    return {
      id: facilityId,
      name: globalThis.WulingCatalogLabels?.facilityName?.(facility || facilityId, fallbackName) || fallbackName,
    };
  }

  function facilityIconHtml(facilityId) {
    return `<img src="assets/icons/facilities/${escapeHtml(facilityId)}.webp" class="mat-icon" alt="">`;
  }

  function recipeList() {
    return globalThis.RECIPES_DB?.recipes || [];
  }

  function recipeItems(entries) {
    if (Array.isArray(entries)) return entries;
    return Object.entries(entries || {}).map(([itemId, amount]) => ({ itemId, amount }));
  }

  function recipeItemListHtml(entries) {
    const items = recipeItems(entries);
    if (!items.length) return `<span class="wuling-tooltip-empty">-</span>`;
    return items.map((entry) => {
      const meta = itemMeta(entry.itemId);
      const amount = Number(entry.amount) || 0;
      return `<span class="wuling-tooltip-material" title="${escapeHtml(meta.name)}">${rawItemIconHtml(entry.itemId)}<span>${escapeHtml(meta.name)}</span><em>x${fmtNumber(amount, amount % 1 ? 2 : 0)}</em></span>`;
    }).join("");
  }

  function recipeTooltipLine(recipe) {
    const facility = facilityMeta(recipe?.facilityId);
    const time = Number(recipe?.craftingTime) || 0;
    return `
      <div class="wuling-recipe-tooltip-line">
        <span class="wuling-recipe-tooltip-facility" title="${escapeHtml(facility.name)}">${rawFacilityIconHtml(recipe?.facilityId)}<strong>${escapeHtml(facility.name)}</strong>${time ? `<em>${fmtNumber(time, time % 1 ? 1 : 0)}s</em>` : ""}</span>
        <span class="wuling-recipe-tooltip-flow">
          <span>${recipeItemListHtml(recipe?.inputs)}</span>
          <b>→</b>
          <span>${recipeItemListHtml(recipe?.outputs)}</span>
        </span>
      </div>
    `;
  }

  function recipesForItem(itemId) {
    const produces = [];
    const uses = [];
    for (const recipe of recipeList()) {
      if (recipeItems(recipe?.outputs).some((entry) => entry.itemId === itemId)) produces.push(recipe);
      if (recipeItems(recipe?.inputs).some((entry) => entry.itemId === itemId)) uses.push(recipe);
    }
    const sortRecipe = (a, b) => String(a?.facilityId || "").localeCompare(String(b?.facilityId || ""))
      || String(a?.id || "").localeCompare(String(b?.id || ""));
    return {
      produces: produces.sort(sortRecipe),
      uses: uses.sort(sortRecipe),
    };
  }

  function recipeSectionHtml(title, recipes) {
    const shown = recipes.slice(0, 6);
    return `
      <section>
        <h4>${escapeHtml(title)}</h4>
        ${shown.length ? shown.map(recipeTooltipLine).join("") : `<div class="wuling-tooltip-empty">No recipes</div>`}
        ${recipes.length > shown.length ? `<div class="wuling-tooltip-more">+${recipes.length - shown.length} more</div>` : ""}
      </section>
    `;
  }

  function itemRecipeTooltipHtml(itemId) {
    const meta = itemMeta(itemId);
    const recipes = recipesForItem(itemId);
    return `
      <div class="wuling-recipe-tooltip-title">${rawItemIconHtml(itemId)}<strong>${escapeHtml(meta.name)}</strong></div>
      ${recipeSectionHtml("Produces", recipes.produces)}
      ${recipeSectionHtml("Used in", recipes.uses)}
    `;
  }

  function tooltipElement() {
    let el = document.getElementById("wuling-recipe-tooltip");
    if (!el) {
      el = document.createElement("div");
      el.id = "wuling-recipe-tooltip";
      el.className = "wuling-recipe-tooltip";
      document.body.appendChild(el);
    }
    return el;
  }

  function showItemRecipeTooltip(anchor, itemId) {
    const el = tooltipElement();
    el.innerHTML = itemRecipeTooltipHtml(itemId);
    el.classList.add("is-visible");
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(520, Math.max(360, window.innerWidth - 24));
    el.style.width = `${width}px`;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width + 10));
    const top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, rect.top - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function hideItemRecipeTooltip() {
    const el = document.getElementById("wuling-recipe-tooltip");
    if (el) el.classList.remove("is-visible");
  }

  function tooltipAnchorFromEvent(event) {
    const target = event?.target;
    if (!target?.closest) return null;
    const wrapped = target.closest(".wuling-item-icon-tip");
    if (wrapped?.dataset?.itemId) return { element: wrapped, itemId: wrapped.dataset.itemId };
    const image = target.closest("img.mat-icon");
    if (!image?.src || !/\/assets\/icons\/items\//.test(image.src.replace(/\\/g, "/"))) return null;
    const item = itemByIconFile(image.src);
    return item?.id ? { element: image, itemId: item.id } : null;
  }

  function installRecipeTooltipDelegation() {
    if (typeof document === "undefined" || document.__wulingRecipeTooltipDelegated) return;
    document.__wulingRecipeTooltipDelegated = true;
    let activeElement = null;
    document.addEventListener("mouseover", (event) => {
      const anchor = tooltipAnchorFromEvent(event);
      if (!anchor || anchor.element === activeElement) return;
      activeElement = anchor.element;
      showItemRecipeTooltip(anchor.element, anchor.itemId);
    });
    document.addEventListener("mouseout", (event) => {
      const anchor = tooltipAnchorFromEvent(event);
      if (!anchor || !activeElement) return;
      if (anchor.element.contains?.(event.relatedTarget)) return;
      activeElement = null;
      hideItemRecipeTooltip();
    });
  }

  function recipeById(result, recipeId) {
    if (result?.graph?.recipeNodes?.get) {
      const graphRecipe = result.graph.recipeNodes.get(recipeId);
      if (graphRecipe) return graphRecipe;
    }
    return recipeList().find((entry) => entry?.id === recipeId) || null;
  }

  function recipeCountEntries(result) {
    const counts = result?.recipeFacilityCounts;
    if (!counts) return [];
    if (counts instanceof Map) return [...counts.entries()];
    return Object.entries(counts);
  }

  function scenario() {
    return globalThis.WULING_STOCK_BILL_SCENARIO ?? null;
  }

  function itemColor(itemId) {
    let hash = 0;
    for (const char of String(itemId || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 72% 58%)`;
  }

  function outputRatePerMinute(recipe, facilityCount, output) {
    const time = Math.max(Number(recipe?.craftingTime) || 1, 1);
    return (Number(facilityCount) || 0) * (60 / time) * (Number(output?.amount) || 0);
  }

  function ratePerUnit(recipe, itemId, direction = "output") {
    const entries = direction === "input" ? recipe?.inputs : recipe?.outputs;
    const entry = (entries || []).find((item) => item?.itemId === itemId);
    const time = Math.max(Number(recipe?.craftingTime) || 1, 1);
    return (60 / time) * (Number(entry?.amount) || 0);
  }

  function rowsFromObject(map, unit = "") {
    if (!map) return [];
    const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
    return entries
      .filter(([, value]) => Math.abs(Number(value) || 0) > 1e-9)
      .map(([id, value]) => ({ id, value: Number(value) || 0, unit }));
  }

  globalThis.WulingDetailHelpers = {
    compactId,
    escapeHtml,
    facilityIconHtml,
    facilityMeta,
    fmtNumber,
    displayDigits,
    itemColor,
    itemIconHtml,
    itemMeta,
    showItemRecipeTooltip,
    hideItemRecipeTooltip,
    normalizeDisplayNumber,
    outputRatePerMinute,
    ratePerUnit,
    recipeById,
    recipeCountEntries,
    recipeList,
    rowsFromObject,
    scenario,
  };
  installRecipeTooltipDelegation();
})();
