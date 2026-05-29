/*
 * Production panel boundary.
 *
 * The current fork still renders the original side-pane directly from
 * endfield_calculator.js.  This module is the future replacement seam for the
 * Wuling-specific Production panel: target ranges, limits, deductions, and
 * policy switches should flow through this object instead of reaching into
 * app globals.
 */
(function () {
  function getState() {
    return globalThis.WulingAppState?.getSnapshot?.() ?? null;
  }

  function render(container, state = getState()) {
    if (!container) return;
    const productionCount = state?.production?.length ?? 0;
    const limitCount = (state?.rawLimits?.length ?? 0) + (state?.facilityLimits?.length ?? 0);
    container.innerHTML = `
      <section class="wuling-production-view">
        <header class="wuling-view-head">
          <h2>Production</h2>
          <span>${productionCount} targets · ${limitCount} limits</span>
        </header>
      </section>
    `;
  }

  globalThis.WulingProductionView = {
    getState,
    render,
  };
})();
