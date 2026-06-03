/*
 * Fraction splitter construction plan renderer.
 *
 * The splitter guide computes the fraction and stores the construction steps.
 * This module only turns those steps into compact UI affordances.
 */
(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function title(fraction) {
    const steps = fraction?.steps || [];
    if (!steps.length) return fraction?.expression || "";
    return steps.map((step, index) => {
      const parts = [`${index + 1}. ${step.from}`];
      if (step.take) parts.push(`take ${step.take}`);
      if (step.use) parts.push(`use ${step.use}`);
      if (step.remainder) parts.push(`rest ${step.remainder}`);
      return parts.join(" / ");
    }).join("\n");
  }

  function t(key, params = {}) {
    return globalThis.WulingI18n?.t?.(key, params) ?? key;
  }

  function svgLabel(value) {
    return String(value ?? "")
      .replace(/\s*×\s*/g, "×")
      .replace(/\s*-\s*/g, "-");
  }

  function svgHtml(fraction) {
    const steps = fraction?.steps || [];
    if (!steps.length) return "";
    const second = steps[1];
    const height = second ? 132 : 116;
    const firstBranchIsUse = !!steps[0]?.use;
    const firstBranch = steps[0]?.use || steps[0]?.take || "";
    const firstBranchClass = firstBranchIsUse ? "is-use" : "is-rest";
    const firstBranchLabelClass = firstBranchIsUse ? "is-use-label" : "is-rest-label";
    const firstRest = steps[0]?.remainder || "";
    const secondUse = second?.use || "";
    const secondRest = second?.remainder || "";
    const isComplementChain = !!second && !firstBranchIsUse;
    const splitCount = Number(fraction?.splitCount) || 0;
    const convergerCount = Number(fraction?.mergeCount) || 0;
    const footerText = splitCount || convergerCount
      ? `${splitCount} ${t("detail.splitter.popup.splitters")} / ${convergerCount} ${t("detail.splitter.popup.convergers")}`
      : "-";
    const secondLayer = second
      ? isComplementChain
        ? `
          <path class="is-carry" d="M74 64 H142" />
          <path class="is-use" d="M154 64 H228" />
          <path class="is-rest" d="M148 70 V104 H218" />
          <path class="is-merge" d="M218 104 H228" />
          <rect class="is-splitter" x="142" y="58" width="12" height="12" rx="2" />
          <text class="is-flow is-use-label" x="151" y="54">${escapeHtml(svgLabel(secondUse))}</text>
          <text class="is-flow is-rest-label" x="154" y="121">${escapeHtml(svgLabel(secondRest))}</text>
          <text class="is-flow is-carry-label" x="103" y="56">${escapeHtml(svgLabel(firstRest))}</text>
        `
        : `
          <path class="is-carry" d="M74 64 H142" />
          <path class="is-use" d="M148 58 V32 H218" />
          <path class="is-rest" d="M148 70 V104 H218" />
          <path class="is-merge" d="M218 104 H228" />
          <rect class="is-splitter" x="142" y="58" width="12" height="12" rx="2" />
          <text class="is-flow is-use-label" x="164" y="44">${escapeHtml(svgLabel(secondUse))}</text>
          <text class="is-flow is-rest-label" x="154" y="121">${escapeHtml(svgLabel(secondRest))}</text>
          <text class="is-flow is-carry-label" x="103" y="56">${escapeHtml(svgLabel(firstRest))}</text>
        `
      : "";
    const firstRestPath = second
      ? ""
      : `<path class="is-rest" d="M68 70 V96 H218" />`;
    return `
      <span class="wuling-fraction-plan">
        <svg viewBox="0 0 240 ${height}" role="img" aria-label="splitter plan">
          <defs>
            <pattern id="wuling-fraction-grid" width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M16 0H0V16" />
            </pattern>
          </defs>
          <rect class="is-grid" x="0" y="0" width="240" height="${height}" />
          <path class="is-input" d="M14 64 H62" />
          <path class="${firstBranchClass}" d="M68 58 V24 H218" />
          ${firstRestPath}
          <rect class="is-splitter" x="62" y="58" width="12" height="12" rx="2" />
          <text class="is-flow is-input-label" x="27" y="56">1</text>
          <text class="is-flow ${firstBranchLabelClass}" x="128" y="18">${escapeHtml(svgLabel(firstBranch))}</text>
          ${second ? "" : `<text class="is-flow is-rest-label" x="118" y="112">${escapeHtml(svgLabel(firstRest))}</text>`}
          ${secondLayer}
        </svg>
        <span class="wuling-fraction-plan-steps">
          <p><span>${escapeHtml(footerText)}</span></p>
        </span>
      </span>
    `;
  }

  let floatingPlan = null;

  function ensureFloatingPlan() {
    if (floatingPlan) return floatingPlan;
    floatingPlan = document.createElement("span");
    floatingPlan.className = "wuling-fraction-plan is-floating";
    document.body.appendChild(floatingPlan);
    return floatingPlan;
  }

  function placeFloatingPlan(source) {
    if (!source || !floatingPlan) return;
    const sourceRect = source.getBoundingClientRect();
    const tipRect = floatingPlan.getBoundingClientRect();
    const gap = 8;
    const margin = 10;
    let left = sourceRect.left + (sourceRect.width / 2) - (tipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
    let top = sourceRect.bottom + gap;
    if (top + tipRect.height > window.innerHeight - margin) {
      top = sourceRect.top - tipRect.height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));
    floatingPlan.style.left = `${left}px`;
    floatingPlan.style.top = `${top}px`;
  }

  function showFloatingPlan(source) {
    const template = source?.querySelector?.(".wuling-fraction-plan");
    if (!template) return;
    const tip = ensureFloatingPlan();
    tip.innerHTML = template.innerHTML;
    tip.classList.add("is-visible");
    placeFloatingPlan(source);
  }

  function hideFloatingPlan() {
    if (!floatingPlan) return;
    floatingPlan.classList.remove("is-visible");
  }

  document.addEventListener("mouseover", (event) => {
    const source = event.target?.closest?.(".wuling-fraction-expression");
    if (!source) return;
    showFloatingPlan(source);
  });

  document.addEventListener("mousemove", (event) => {
    const source = event.target?.closest?.(".wuling-fraction-expression");
    if (!source || !floatingPlan?.classList.contains("is-visible")) return;
    placeFloatingPlan(source);
  });

  document.addEventListener("mouseout", (event) => {
    const source = event.target?.closest?.(".wuling-fraction-expression");
    if (!source || source.contains(event.relatedTarget)) return;
    hideFloatingPlan();
  });

  globalThis.WulingFractionPlan = {
    svgHtml,
    title,
  };
})();
