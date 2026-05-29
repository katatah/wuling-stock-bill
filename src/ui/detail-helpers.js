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

  function itemMeta(itemId) {
    const item = (globalThis.ITEMS_DB || []).find((entry) => entry?.id === itemId);
    const fallbackName = item?.name || compactId(itemId);
    return {
      iconFile: item?.iconFile || "",
      name: globalThis.WulingCatalogLabels?.itemName?.(item || itemId, fallbackName) || fallbackName,
    };
  }

  function itemIconHtml(itemId) {
    const meta = itemMeta(itemId);
    return meta.iconFile
      ? `<img src="assets/icons/items/${escapeHtml(meta.iconFile)}" class="mat-icon" alt="">`
      : "";
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
    normalizeDisplayNumber,
    outputRatePerMinute,
    ratePerUnit,
    recipeById,
    recipeCountEntries,
    recipeList,
    rowsFromObject,
    scenario,
  };
})();
