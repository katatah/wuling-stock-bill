(function (global) {
  const WULING_CANDIDATE_POLICIES = [
    {
      id: "power",
      label: "Low power max",
      hidden: false,
      purpose: "Keep the best bill value and prefer lower power when possible.",
      sequence: ["maximize-bills", "minimize-power", "minimize-facilities"],
    },
    {
      id: "practical-integer",
      label: "Practical integer",
      hidden: true,
      purpose: "Prefer final trade item recipes that are easier to build with integer facility counts.",
      sequence: ["choose-integer-friendly-final-recipes", "maximize-bills", "minimize-power"],
    },
    {
      id: "raw-max",
      label: "Raw maximum",
      hidden: true,
      purpose: "Internal baseline for the theoretical maximum bill value.",
      sequence: ["maximize-bills"],
    },
  ];

  function candidatePoliciesForScenario(_scenario, options = {}) {
    const includeHidden = !!options.includeHidden;
    return WULING_CANDIDATE_POLICIES
      .filter((policy) => includeHidden || !policy.hidden)
      .map((policy) => ({ ...policy, sequence: [...policy.sequence] }));
  }

  global.WulingCandidatePolicies = {
    candidatePoliciesForScenario,
    definitions: WULING_CANDIDATE_POLICIES,
  };
})(globalThis);
