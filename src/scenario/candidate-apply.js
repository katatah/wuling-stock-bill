/*
 * Candidate apply helpers.
 *
 * A candidate row is a solved proposal.  Applying it should copy the gross
 * exchange design back into the Production panel as editable starting values.
 */
(function (global) {
  function resourceBoostId(boost) {
    return boost?.itemId ? `resource-boost:${boost.itemId}:${Number(boost.amount || 0)}` : "";
  }

  function candidateApplyPlan(candidate) {
    const composition = candidate?.summary?.billComposition ?? [];
    const production = composition
      .filter((entry) => entry?.itemId && Number(entry.designRate || 0) > 1e-9)
      .map((entry) => ({
        itemId: entry.itemId,
        rate: Number(entry.designRate) || 0,
        locked: false,
        optimized: false,
      }));
    const selectedResourceBoostId = resourceBoostId(candidate?.variant?.boost);
    return {
      production,
      selectedResourceBoostId,
    };
  }

  global.WulingCandidateApply = {
    candidateApplyPlan,
    resourceBoostId,
  };
})(globalThis);
