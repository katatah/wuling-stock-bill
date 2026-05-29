/*
 * Lightweight browser i18n helper.
 *
 * Static HTML can opt in with:
 *   data-i18n="key"
 *   data-i18n-placeholder="key"
 *   data-i18n-title="key"
 *   data-i18n-aria-label="key"
 *
 * Script-rendered UI can call:
 *   globalThis.WulingI18n.t("key")
 */
(function (global) {
  const STORAGE_KEY = "wuling-stock-bill.locale";
  const DEFAULT_LOCALE = "en";

  const dictionaries = {
    en: {
      "app.title": "Wuling Stock Bill Guide",
      "nav.main": "Setup & Solver",
      "nav.prices": "Prices & Recipes",
      "language.label": "Language",
      "button.toggleSidePanel": "Toggle side panel",
      "button.showProductionPanel": "Show production panel",
      "button.collapse": "Collapse",
      "panel.production": "Production",
      "panel.rawResourceLimits": "Raw Resource Limits",
      "panel.facilityLimits": "Facility Limits",
      "panel.deductions": "Deductions",
      "panel.productionSummary": "Production Summary",
      "panel.resourceFacilityUsage": "Resource & Facility Usage",
      "panel.recipes": "Recipes",
      "production.transfer": "Transfer",
      "production.prioritizeUnsellable": "Prioritize Unsellable",
      "production.autoSolve": "Auto-solve",
      "placeholder.addProductionTarget": "Add production target...",
      "placeholder.addRawResourceLimit": "Add raw resource limit...",
      "placeholder.addFacilityLimit": "Add facility limit...",
      "placeholder.addDeduction": "Add deduction...",
      "placeholder.searchItems": "Search items...",
      "empty.noProducts": "No products added yet",
      "empty.usage": "Add raw resource or facility limits to see usage",
      "empty.prices": "Search for items above to set their sell price",
      "prices.subtitle": "Set sell price per item - used by the LP objective",
      "footer.disclaimer": "Arknights: Endfield is a trademark of Hypergryph. This tool is not affiliated with or endorsed by Hypergryph.",
      "footer.license": "MIT License",
      "candidate.title": "Candidates",
      "candidate.status.generating": "generating...",
      "candidate.status.notGenerated": "not generated",
      "candidate.status.rows": "{rows} rows",
      "candidate.status.tried": "{tried} tried",
      "candidate.status.ms": "{ms} ms",
      "candidate.header.bills": "Bills",
      "candidate.header.transfer": "Transfer",
      "candidate.empty": "Candidate generation will appear here.",
      "candidate.applyTitle": "Double-click to apply this candidate to Production",
      "candidate.productionSelection": "Production selection",
      "candidate.afterDeductions": "After deductions",
      "detail.title": "Selected Candidate",
      "detail.noCandidate": "No candidate selected",
      "detail.apply": "Apply to Production",
      "detail.openEndfieldCalc": "Open in endfield-calc",
      "detail.close": "Close",
      "detail.billComposition": "Bill composition",
      "detail.bill.empty": "No bill composition available.",
      "detail.bill.final": "Final",
      "detail.bill.deduct": "Deduct",
      "detail.bill.adjustLoss": "Adjust loss",
      "detail.bill.adjustGain": "Adjust gain",
      "detail.bill.header.item": "Item",
      "detail.bill.header.design": "Design",
      "detail.bill.header.deduct": "Deduct",
      "detail.bill.header.adjust": "Adjust",
      "detail.bill.header.final": "Final",
      "detail.bill.header.bill": "Bill",
      "detail.splitter.title": "Fraction splitter guide",
      "detail.splitter.mode": "Splitter mode",
      "detail.splitter.item": "Item",
      "detail.splitter.facility": "Facility",
      "detail.splitter.output": "Output",
      "detail.splitter.perUnit": "Per unit",
      "detail.splitter.units": "Units",
      "detail.splitter.split": "Split",
      "detail.splitter.splitMerge": "Split / Merge",
      "detail.splitter.error": "Error",
      "detail.splitter.empty": "No fractional final recipe units in the exchange-only design.",
      "detail.usage.emptyRaw": "No raw resource limits.",
      "detail.usage.noFacilities": "No facility usage.",
      "detail.usage.facilities": "Facilities",
      "detail.empty": "Generate candidates and select one to inspect the result.",
    },
    ja: {
      "app.title": "武陵取引券ガイド",
      "nav.main": "条件と候補",
      "nav.prices": "単価とレシピ",
      "language.label": "言語",
      "button.toggleSidePanel": "サイドパネルを切り替え",
      "button.showProductionPanel": "Production パネルを表示",
      "button.collapse": "折りたたみ",
      "panel.production": "Production",
      "panel.rawResourceLimits": "原材料上限",
      "panel.facilityLimits": "施設上限",
      "panel.deductions": "控除",
      "panel.productionSummary": "生産サマリ",
      "panel.resourceFacilityUsage": "資源・施設使用量",
      "panel.recipes": "レシピ",
      "production.transfer": "Transfer",
      "production.prioritizeUnsellable": "非売却品優先",
      "production.autoSolve": "自動計算",
      "placeholder.addProductionTarget": "生産対象を追加...",
      "placeholder.addRawResourceLimit": "原材料上限を追加...",
      "placeholder.addFacilityLimit": "施設上限を追加...",
      "placeholder.addDeduction": "控除を追加...",
      "placeholder.searchItems": "資材を検索...",
      "empty.noProducts": "生産対象がありません",
      "empty.usage": "原材料または施設の上限を追加すると使用量が表示されます",
      "empty.prices": "上の検索から資材を選んで単価を設定します",
      "prices.subtitle": "資材ごとの売却単価を設定します。LP の目的関数で使用されます",
      "footer.disclaimer": "Arknights: Endfield は Hypergryph の商標です。このツールは Hypergryph と提携しておらず、承認されたものでもありません。",
      "footer.license": "MIT License",
      "candidate.title": "候補",
      "candidate.status.generating": "生成中...",
      "candidate.status.notGenerated": "未生成",
      "candidate.status.rows": "{rows} 行",
      "candidate.status.tried": "{tried} 件試行",
      "candidate.status.ms": "{ms} ms",
      "candidate.header.bills": "取引券",
      "candidate.header.transfer": "Transfer",
      "candidate.empty": "候補はここに表示されます。",
      "candidate.applyTitle": "ダブルクリックで候補を Production に反映",
      "candidate.productionSelection": "Production の選択値",
      "candidate.afterDeductions": "控除後",
      "detail.title": "選択中候補",
      "detail.noCandidate": "候補が選択されていません",
      "detail.apply": "Production に反映",
      "detail.openEndfieldCalc": "endfield-calc で開く",
      "detail.close": "閉じる",
      "detail.billComposition": "交換券内訳",
      "detail.bill.empty": "交換券内訳はありません。",
      "detail.bill.final": "結果",
      "detail.bill.deduct": "控除",
      "detail.bill.adjustLoss": "調整減",
      "detail.bill.adjustGain": "調整増",
      "detail.bill.header.item": "資材",
      "detail.bill.header.design": "設計",
      "detail.bill.header.deduct": "控除",
      "detail.bill.header.adjust": "調整",
      "detail.bill.header.final": "結果",
      "detail.bill.header.bill": "券",
      "detail.splitter.title": "端数分流ガイド",
      "detail.splitter.mode": "分流モード",
      "detail.splitter.item": "資材",
      "detail.splitter.facility": "施設",
      "detail.splitter.output": "出力",
      "detail.splitter.perUnit": "1台分",
      "detail.splitter.units": "台数",
      "detail.splitter.split": "分流",
      "detail.splitter.splitMerge": "分流 / 合流",
      "detail.splitter.error": "誤差",
      "detail.splitter.empty": "交換設計に端数の最終レシピ施設はありません。",
      "detail.usage.emptyRaw": "原材料上限はありません。",
      "detail.usage.noFacilities": "施設使用量はありません。",
      "detail.usage.facilities": "施設",
      "detail.empty": "候補を生成して選択すると詳細が表示されます。",
    },
    "zh-CN": {
      "app.title": "武陵票据指南",
      "nav.main": "设置与求解",
      "nav.prices": "价格与配方",
      "language.label": "语言",
      "button.toggleSidePanel": "切换侧边栏",
      "button.showProductionPanel": "显示生产面板",
      "button.collapse": "折叠",
      "panel.production": "Production",
      "panel.rawResourceLimits": "原料上限",
      "panel.facilityLimits": "设施上限",
      "panel.deductions": "扣除",
      "panel.productionSummary": "生产汇总",
      "panel.resourceFacilityUsage": "资源与设施用量",
      "panel.recipes": "配方",
      "production.transfer": "Transfer",
      "production.prioritizeUnsellable": "优先不可出售物",
      "production.autoSolve": "自动求解",
      "placeholder.addProductionTarget": "添加生产目标...",
      "placeholder.addRawResourceLimit": "添加原料上限...",
      "placeholder.addFacilityLimit": "添加设施上限...",
      "placeholder.addDeduction": "添加扣除...",
      "placeholder.searchItems": "搜索物品...",
      "empty.noProducts": "尚未添加产品",
      "empty.usage": "添加原料或设施上限后显示用量",
      "empty.prices": "在上方搜索物品并设置售价",
      "prices.subtitle": "设置每种物品的售价，用于 LP 目标函数",
      "footer.disclaimer": "Arknights: Endfield 是 Hypergryph 的商标。本工具与 Hypergryph 无关联，也未获得其认可。",
      "footer.license": "MIT License",
      "candidate.title": "候选",
      "candidate.status.generating": "生成中...",
      "candidate.status.notGenerated": "尚未生成",
      "candidate.status.rows": "{rows} 行",
      "candidate.status.tried": "尝试 {tried} 次",
      "candidate.status.ms": "{ms} ms",
      "candidate.header.bills": "票据",
      "candidate.header.transfer": "Transfer",
      "candidate.empty": "候选结果会显示在这里。",
      "candidate.applyTitle": "双击将此候选应用到 Production",
      "candidate.productionSelection": "Production 选择",
      "candidate.afterDeductions": "扣除后",
      "detail.title": "已选候选",
      "detail.noCandidate": "未选择候选",
      "detail.apply": "应用到 Production",
      "detail.openEndfieldCalc": "在 endfield-calc 中打开",
      "detail.close": "关闭",
      "detail.billComposition": "票据构成",
      "detail.bill.empty": "没有票据构成。",
      "detail.bill.final": "结果",
      "detail.bill.deduct": "扣除",
      "detail.bill.adjustLoss": "调整减少",
      "detail.bill.adjustGain": "调整增加",
      "detail.bill.header.item": "物品",
      "detail.bill.header.design": "设计",
      "detail.bill.header.deduct": "扣除",
      "detail.bill.header.adjust": "调整",
      "detail.bill.header.final": "结果",
      "detail.bill.header.bill": "票据",
      "detail.splitter.title": "分流指南",
      "detail.splitter.mode": "分流模式",
      "detail.splitter.item": "物品",
      "detail.splitter.facility": "设施",
      "detail.splitter.output": "输出",
      "detail.splitter.perUnit": "单台",
      "detail.splitter.units": "台数",
      "detail.splitter.split": "分流",
      "detail.splitter.splitMerge": "分流 / 合流",
      "detail.splitter.error": "误差",
      "detail.splitter.empty": "交换设计中没有带小数的最终配方设施。",
      "detail.usage.emptyRaw": "没有原料上限。",
      "detail.usage.noFacilities": "没有设施用量。",
      "detail.usage.facilities": "设施",
      "detail.empty": "生成并选择候选后可查看详情。",
    },
  };

  const aliases = {
    "zh": "zh-CN",
    "zh-Hans": "zh-CN",
    "zh-SG": "zh-CN",
    "zh-CN": "zh-CN",
    "ja-JP": "ja",
  };

  const listeners = new Set();
  let locale = normalizeLocale(localStorage.getItem(STORAGE_KEY)) || browserLocale() || DEFAULT_LOCALE;

  function normalizeLocale(value) {
    if (!value) return "";
    if (dictionaries[value]) return value;
    if (aliases[value]) return aliases[value];
    const short = String(value).split("-")[0];
    return dictionaries[short] ? short : "";
  }

  function browserLocale() {
    const values = [navigator.language, ...(navigator.languages || [])];
    for (const value of values) {
      const normalized = normalizeLocale(value);
      if (normalized) return normalized;
    }
    return "";
  }

  function interpolate(text, params = {}) {
    return String(text).replace(/\{(\w+)\}/g, (_, key) => (
      Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`
    ));
  }

  function t(key, params = {}) {
    const text = dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE]?.[key] ?? key;
    return interpolate(text, params);
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((node) => {
      node.setAttribute("title", t(node.getAttribute("data-i18n-title")));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
      node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria-label")));
    });
    document.documentElement.lang = locale;
    document.title = t("app.title");
    const select = document.getElementById("locale-select");
    if (select) select.value = locale;
  }

  function setLocale(nextLocale) {
    const normalized = normalizeLocale(nextLocale) || DEFAULT_LOCALE;
    if (normalized === locale) return;
    locale = normalized;
    localStorage.setItem(STORAGE_KEY, locale);
    apply();
    for (const listener of listeners) listener(locale);
    global.dispatchEvent(new CustomEvent("wuling:localechange", { detail: { locale } }));
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  global.WulingI18n = {
    apply,
    dictionaries,
    getLocale: () => locale,
    locales: [
      { id: "en", label: "English" },
      { id: "ja", label: "日本語" },
      { id: "zh-CN", label: "简体中文" },
    ],
    onChange,
    setLocale,
    t,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => apply());
  } else {
    apply();
  }
})(globalThis);
