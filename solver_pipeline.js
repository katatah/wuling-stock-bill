/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  ENDFIELD PRODUCTION SOLVER — PIPELINE  (solver_pipeline.js)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This file owns everything that turns user inputs into a solved production
 *  schedule:
 *
 *    1. HiGHS LP adapter   — compileLP / solveLP / setHighsInstance
 *    2. Max-rate cache      — per-item ceiling via mini-LP; invalidated on limit changes
 *    3. Pipeline helpers    — calcRate, recipe selectors
 *    4. Graph builder       — DFS + byproduct-recycler augment + cycle repair
 *    5. Flow analysis       — net item rates and raw/facility usage from a schedule
 *    6. Solver state        — cached last result, throttle handle, timing
 *    7. Solver core         — runSolver (single global LP), updateSlidersInPlace, logS
 *
 *  End-to-end flow inside runSolver
 *  ─────────────────────────────────
 *
 *    production[], rawLimits, facilityLimits
 *                    │
 *     Phase 1 ───────┤  buildBipartiteGraph
 *                    │  DFS from each target → add ALL viable recipes per item
 *                    │  Augment: add FD-byproduct recyclers (e.g. xiranite purifier)
 *                    │  Repair:  inject all viable recipes for cycle-stranded items
 *                    │
 *     Phase 2 ───────┤  Build LP
 *                    │  Variables : x_ri  — facility count for recipe r (≥ 0)
 *                    │              surp_X — surplus absorber for zero-price dead ends
 *                    │  Constraints:
 *                    │    bal_X   net production ≥ 0  (= pinnedRate for fixed items)
 *                    │    raw_R   Σ consumption ≤ rawCap
 *                    │    fac_F   Σ facility counts ≤ facCap
 *                    │    ub_net_X  net production ≤ singleMaxRate[X]  (unbounded guard)
 *                    │  Objective: maximise Σ price(X) × net_rate(X) − surplus penalties
 *                    │             − (MACHINE_PENALTY + POWER_WEIGHT × facility_kw) per facility
 *                    │  Optional MIP: when f.integerOnly is set on a facilityLimit, the
 *                    │    x_ri for every recipe that uses that facility are added to the
 *                    │    LP General section → HiGHS solves as MIP, counts are integers
 *                    │
 *     Phase 3 ───────┤  Solve via HiGHS (CPLEX LP text → WebAssembly)
 *                    │
 *     Phase 4 ───────┤  Extract recipeFacilityCounts from x_ri solution values
 *                    │
 *     Phase 5 ───────┤  Sanity check — abort if LP solution violates any cap by > 0.5
 *                    │
 *     Phase 6 ───────┤  Apply results
 *                    │  Snap LP residuals < 1e-3 → 0  (keeps slider/summary in sync)
 *                    │  Write p.rate, mark p.optimized, cache _lastGraph / _lastFacilityCounts
 *                    │  Render summary + usage bars
 *
 *  Power (battery) consumption is NOT part of the LP.  Battery cost is a
 *  post-solve display subtraction: computeSummary subtracts pb.rate from
 *  netRates[pb.matId].  This keeps the LP constraints clean and lets the
 *  user see the gross vs net split explicitly.
 *
 *  singleMaxRate and the unbounded guard
 *  ────────────────────────────────────
 *  Without raw/facility caps, a self-sustaining production cycle (e.g. the
 *  moss/seed loop) makes the profit objective unbounded — HiGHS returns
 *  "Infeasible or Unbounded".  The fix is to cap every priced item's net
 *  production at the most it could ever be if that item were the only target
 *  (singleMaxRate, computed by a mini-LP).  These ub_net_X constraints bound
 *  the objective without affecting the LP's optimal solution when caps are
 *  present — a cap-constrained optimum is always ≤ the unconstrained
 *  singleMax.  singleMaxRate is computed lazily and cached; _singleMaxDirty causes
 *  a full rebuild only when limits or item list changes.
 *
 *  Globals consumed from endfield_calculator.js (present at call time):
 *    production, rawLimits, facilityLimits, prices, powerBatteries
 *    outpostCostDefault, tempPinnedId
 *    priceOf, prodEntry, isFixed, recipeFor, getSolverWeight
 *    computeSummary, renderProducts, fmt, setSliderFill
 *
 *  Globals consumed from assets/recipes.js:
 *    recipesByOutput, recipesByInput, recipeById, forcedRawSet, forcedDisposalSet
 *
 *  Globals consumed from assets/items.js:
 *    itemById
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════
   § 1  HIGHS LP SOLVER ADAPTER

   The solver pipeline emits LP models as plain JS objects:
     {
       optimize:    string,           // objective variable name
       opType:      'max' | 'min',
       constraints: { name: { max|min|equal: number } },
       variables:   { name: { [constraintOrObj]: coef } },
       generals?:   string[]          // optional: variable names declared as integers
     }

   compileLP serialises this into CPLEX LP format text;  solveLP runs it
   through HiGHS and returns:
     { feasible: bool, result: number, [varName]: value }

   When generals is non-empty, compileLP appends a "General" section before
   "End", turning the solve into a MIP.  HiGHS handles both LP and MIP via
   the same solve() call — no adapter changes needed.

   HiGHS is loaded as a WebAssembly module. index.html awaits the WASM
   promise and calls setHighsInstance(solver) to install it. While _highs
   is null, isHighsReady() returns false and runSolver aborts with a user-
   visible message rather than a JS exception.
═══════════════════════════════════════════════ */

// Resolved HiGHS WebAssembly instance; null until setHighsInstance is called.
let _highs = null;

function isHighsReady() { return !!_highs; }

// Queued solve from before HiGHS was ready — drained by setHighsInstance.
let _pendingSolve = null;

// Called by the index.html bootstrap once the HiGHS WASM promise resolves.
// If the app already has production items (e.g. state was restored from
// localStorage before the WASM was ready), invalidate the max cache and
// recompute so sliders show real ceilings instead of the 1e6 fallback.
function setHighsInstance(h) {
  _highs = h;
  if (typeof production !== 'undefined' && production.length) {
    invalidateMaxCache(); recomputeAllMax(); renderProducts();
    const pending = _pendingSolve || { inPlace: false, pinAll: !autoSolveOn() };
    _pendingSolve = null;
    runSolver(pending.inPlace, pending.pinAll);
  }
}
// If the HiGHS WASM resolved before this script loaded, the head bootstrap
// stashed the instance in window._highsPending — consume it now.
if (window._highsPending) { setHighsInstance(window._highsPending); window._highsPending = null; }

// compileLP: serialise an LP model object into CPLEX LP format text.
//
// CPLEX LP format is a whitespace-sensitive text format that HiGHS accepts.
// Layout:
//   Maximize / Minimize
//     obj: <expr>
//   Subject To
//     <name>: <expr> <= / >= / = <bound>
//   End
//
// All variables default to [0, ∞) in CPLEX LP — no Bounds section needed
// because every variable here is either a facility count (x_ri ≥ 0) or a
// surplus absorber (surp_X ≥ 0).
// When model.generals is non-empty, a "General" section is appended so HiGHS
// treats those variables as integers, turning the problem into a MIP.
function compileLP(model) {
  const objName    = model.optimize;
  const opType     = (model.opType || 'max').toLowerCase();
  const objKeyword = opType === 'min' ? 'Minimize' : 'Maximize';

  // Walk all variables once, bucketing each non-zero coefficient into the
  // objective term list or the appropriate constraint term list.
  const constraintTerms = new Map();
  for (const cname of Object.keys(model.constraints)) constraintTerms.set(cname, []);
  const objTerms = [];

  for (const vname of Object.keys(model.variables)) {
    const coefs = model.variables[vname];
    for (const key of Object.keys(coefs)) {
      const c = coefs[key];
      if (!isFinite(c) || c === 0) continue;
      const term = (c < 0 ? '- ' : '+ ') + Math.abs(c) + ' ' + vname;
      if (key === objName) objTerms.push(term);
      else if (constraintTerms.has(key)) constraintTerms.get(key).push(term);
    }
  }

  const stripLeadingPlus = s => s.replace(/^\+\s+/, '');
  const objExpr = objTerms.length ? stripLeadingPlus(objTerms.join(' ')) : '0';

  const cLines = [];
  for (const [cname, bound] of Object.entries(model.constraints)) {
    const terms = constraintTerms.get(cname);
    if (!terms || !terms.length) continue;  // HiGHS rejects empty constraint rows
    const expr = stripLeadingPlus(terms.join(' '));
    if ('max' in bound)        cLines.push('  ' + cname + ': ' + expr + ' <= ' + bound.max);
    else if ('min' in bound)   cLines.push('  ' + cname + ': ' + expr + ' >= ' + bound.min);
    else if ('equal' in bound) cLines.push('  ' + cname + ': ' + expr + ' = '  + bound.equal);
  }

  const generalSection = (model.generals && model.generals.length)
    ? '\nGeneral\n  ' + model.generals.join('\n  ') + '\n'
    : '';
  return objKeyword + '\n  obj: ' + objExpr + '\nSubject To\n' + cLines.join('\n') + generalSection + '\nEnd\n';
}

// solveLP: run a model through HiGHS and return a flat result map.
// HiGHS' solve() returns a HighsSolution object; this adapter reshapes it
// into { feasible, result, [varName]: value } so call sites are insulated
// from HiGHS' internal return shape.
function solveLP(model) {
  if (!_highs) throw new Error('HiGHS not initialised');
  const text = _highs.solve(compileLP(model));
  const feasible = text.Status === 'Optimal';
  const out = { feasible, result: text.ObjectiveValue };
  if (feasible && text.Columns) {
    for (const [name, col] of Object.entries(text.Columns)) out[name] = col.Primal;
  }
  return out;
}


/* ═══════════════════════════════════════════════
   § 2  MAX-RATE CACHE

   For each priced item in the graph, we need an upper bound on how fast
   it can be produced (singleMaxRate).  This is computed by a mini-LP that
   maximises net production of just that item against the current
   raw/facility limits.

   Two-level caching strategy
   ──────────────────────────
   _maxCache   (Map)  — memoises solveItemMax results keyed by
                        itemId + recipeId + facLimits fingerprint + rawLimits fingerprint.
                        Cleared by invalidateMaxCache().

   _singleMaxMap (obj)  — a flat { itemId → maxRate } map rebuilt from
                        _maxCache or solveItemMax calls whenever
                        _singleMaxDirty is true. The dirty flag is set by
                        invalidateMaxCache() (called when limits or item
                        list changes). During drag, _singleMaxDirty stays
                        false, so runSolver skips the rebuild entirely
                        and singleMax lookups are O(1) object reads.
═══════════════════════════════════════════════ */

// Primary memoisation map: cache key → max rate (number).
const _maxCache = new Map();

// Flat itemId → maxRate snapshot; rebuilt lazily from _maxCache/_solveItemMax.
let _singleMaxMap = {};
let _singleMaxDirty = true;

// Cache key: encodes everything that can affect the max rate for an item —
// the item's chosen recipe, every facility limit, and every raw limit.
// Any change to limits triggers invalidateMaxCache(), which clears the map
// and sets _singleMaxDirty so the next runSolver call rebuilds _singleMaxMap.
function _maxCacheKey(id) {
  const p = prodEntry(id);
  const recipeId = p?.recipeId || '';
  const facKey = facilityLimits.map(f => f.gameFacilityId + ':' + f.cap).join(',');
  const rawKey = rawLimits.map(r => r.matId + ':' + r.cap).join(',');
  return id + '|' + recipeId + '|' + facKey + '|' + rawKey;
}

// Invalidate both caches — called whenever the limit fingerprint changes.
function invalidateMaxCache() { _maxCache.clear(); _singleMaxDirty = true; }

// solveItemMax: mini-LP that maximises net production of a single item.
// Builds the same balance/raw/facility constraint structure as the global LP
// but with a single-item objective and no pinned items or batteries.
// Returns the max rate (number ≥ 0) or null on solver failure.
function solveItemMax(targetId, graph) {
  const recipeList = [...graph.recipeNodes.values()];
  if (!recipeList.length) return null;
  const constraints = {};
  const variables = {};
  recipeList.forEach((_, ri) => { variables[`x_${ri}`] = {}; });

  // Balance: net production ≥ 0 for every non-raw item.
  // (Same structure as the global LP's bal_X constraints.)
  graph.itemNodes.forEach((info, iid) => {
    if (info.isRawMaterial) return;
    const cName = `bal_${iid}`;
    let hasCoef = false;
    recipeList.forEach((r, ri) => {
      let coef = 0;
      (r.outputs || []).forEach(o => { if (o.itemId === iid) coef += calcRate(o.amount, r.craftingTime); });
      (r.inputs  || []).forEach(i => { if (i.itemId === iid) coef -= calcRate(i.amount, r.craftingTime); });
      if (Math.abs(coef) > 1e-12) { variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + coef; hasCoef = true; }
    });
    if (hasCoef) constraints[cName] = { min: 0 };
  });

  // Raw material caps (replicate global LP's raw_R constraints).
  rawLimits.forEach(rl => {
    const cName = `raw_${rl.matId}`;
    constraints[cName] = { max: rl.cap };
    recipeList.forEach((r, ri) => {
      const inp = (r.inputs || []).find(i => i.itemId === rl.matId);
      if (inp) variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + calcRate(inp.amount, r.craftingTime);
    });
  });

  // Facility caps (replicate global LP's fac_F constraints).
  facilityLimits.forEach(f => {
    const cName = `fac_${f.gameFacilityId}`;
    constraints[cName] = { max: f.cap };
    recipeList.forEach((r, ri) => {
      if (r.facilityId === f.gameFacilityId)
        variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + 1;
    });
  });

  // Single-item profit objective: maximise net production of targetId.
  recipeList.forEach((r, ri) => {
    let coef = 0;
    (r.outputs || []).forEach(o => { if (o.itemId === targetId) coef += calcRate(o.amount, r.craftingTime); });
    (r.inputs  || []).forEach(i => { if (i.itemId === targetId) coef -= calcRate(i.amount, r.craftingTime); });
    if (Math.abs(coef) > 1e-12) variables[`x_${ri}`].obj = coef;
  });

  const result = solveLP({ optimize: 'obj', opType: 'max', constraints, variables });
  if (!result?.feasible || result.result == null) return null;
  // Treat near-zero results as exactly 0 (LP arithmetic noise).
  return result.result > 1e-9 ? result.result : 0;
}

// solveMaxForItem: public entry point for per-item max rate.
// Checks _maxCache first; falls back to solveItemMax (or a simple facility-
// count bound when HiGHS isn't loaded yet).
function solveMaxForItem(id) {
  const cacheKey = _maxCacheKey(id);
  if (_maxCache.has(cacheKey)) return _maxCache.get(cacheKey);

  const p = prodEntry(id);
  const r = p ? recipeFor(p) : null;
  if (!r) { _maxCache.set(cacheKey, 1e6); return 1e6; }

  const out = (r.outputs || []).find(o => o.itemId === id);
  const outputRatePerFac = out ? calcRate(out.amount, r.craftingTime) : 0;
  if (outputRatePerFac <= 0) { _maxCache.set(cacheKey, 1e6); return 1e6; }

  let final = 1e6;
  if (isHighsReady()) {
    try {
      // Build a graph rooted at this item only (honours any user recipe override).
      const overrides = p?.recipeId ? new Map([[id, p.recipeId]]) : new Map();
      const graph = buildBipartiteGraph([id], overrides);
      if (graph.recipeNodes.size) {
        const v = solveItemMax(id, graph);
        // v >= 0 check: cap=0 on the item's facility means v=0 is a valid answer.
        if (typeof v === 'number' && isFinite(v) && v >= 0) final = v;
      }
    } catch (e) {
      // HiGHS error: fall back to simple facility-count ceiling.
      let mx = Infinity;
      facilityLimits.forEach(f => {
        if (f.gameFacilityId === r.facilityId) mx = Math.min(mx, f.cap * outputRatePerFac);
      });
      if (isFinite(mx) && mx >= 0) final = mx;
    }
  } else {
    // HiGHS not yet loaded: approximate with facility count × output rate.
    let mx = Infinity;
    facilityLimits.forEach(f => {
      if (f.gameFacilityId === r.facilityId) mx = Math.min(mx, f.cap * outputRatePerFac);
    });
    if (isFinite(mx) && mx >= 0) final = mx;
  }

  _maxCache.set(cacheKey, final);
  return final;
}

// recomputeMax: refresh the maxRate on a single production entry.
function recomputeMax(p) { p.maxRate = solveMaxForItem(p.id); }

// recomputeAllMax: refresh maxRate on every production entry.
// Called after HiGHS finishes loading (so the 1e6 fallbacks get replaced).
function recomputeAllMax() { production.forEach(p => recomputeMax(p)); }

// recomputeMaxForFacility: called when a facility limit changes.
// Clamps any slider that was above the new ceiling.
function recomputeMaxForFacility(typeId) {
  invalidateMaxCache();
  production.forEach(p => {
    recomputeMax(p);
    if (p.rate > p.maxRate) p.rate = p.maxRate;
  });
}

// recomputeMaxForRaw: called when a raw resource limit changes.
// Same clamp logic as recomputeMaxForFacility.
function recomputeMaxForRaw() {
  invalidateMaxCache();
  production.forEach(p => {
    recomputeMax(p);
    if (p.rate > p.maxRate) p.rate = p.maxRate;
  });
}


/* ═══════════════════════════════════════════════
   § 3  PIPELINE HELPERS

   Small pure functions used by the graph builder and LP constructor.
═══════════════════════════════════════════════ */

// calcRate: convert a recipe's "amount per crafting cycle" into items/minute.
// Every rate value in the LP (coefficient and output bound) goes through this.
function calcRate(amount, craftingTime) { return amount / craftingTime * 60; }

// isDismantleRecipe: true when the recipe consumes a filled-bottle item.
// Filled-bottle inputs are produced as byproducts of certain chemical
// processes; recipes that take them as inputs are "dismantle" sinks, not
// real production paths.  The DFS skips them during recipe selection.
function isDismantleRecipe(r) {
  return (r.inputs || []).some(i => i.itemId.startsWith('item_fbottle_'));
}

// isDisposalOnlyRecipe: true when EVERY input is a forced-disposal item.
// These recipes are pure byproduct sinks (e.g. liquid_purifier_xiranite_poly
// which converts waste lxp_lowpoly back to useful lxp).  The DFS avoids
// picking them as the primary producer for an item; the augmentation pass
// adds them back as recyclers once the main graph is built.
function isDisposalOnlyRecipe(r) {
  const inps = r.inputs || [];
  if (inps.length === 0) return false;
  return inps.every(i => forcedDisposalSet.has(i.itemId));
}

// selectRecipe: recipe selection heuristic.
//
// Filter cascade applied in order:
//   1. Drop dismantle recipes (filled-bottle inputs)
//   2. Drop disposal-only recipes (all-FD inputs; added later as recyclers)
//   3. Prefer single-output recipes (avoids picking multi-output alternates
//      that generate unwanted byproducts as the primary path)
//   4. Within each tier, prefer a recipe whose EVERY input is a forced-raw
//      material — it terminates the DFS immediately and avoids synthetic
//      cycles like "iron_powder → iron_nugget" that have no external entry.
//   5. If visitedPath is provided, prefer non-circular (no input already on
//      the DFS stack) to break tie-loops in multi-input items.
function selectRecipe(recipes, visitedPath) {
  const nonDismantle = recipes.filter(r => !isDismantleRecipe(r));
  const stage1 = nonDismantle.length > 0 ? nonDismantle : recipes;
  const nonDisposal = stage1.filter(r => !isDisposalOnlyRecipe(r));
  const pool = nonDisposal.length > 0 ? nonDisposal : stage1;
  const singleOutput = pool.filter(r => (r.outputs || []).length === 1);

  function pickBest(candidates) {
    const allRaw = candidates.filter(r =>
      (r.inputs || []).length > 0 &&
      (r.inputs || []).every(i => forcedRawSet.has(i.itemId)));
    return allRaw.length > 0 ? allRaw[0] : candidates[0];
  }

  if (singleOutput.length > 0) {
    if (visitedPath && visitedPath.size > 0) {
      const nonCircular = singleOutput.filter(r =>
        !(r.inputs || []).some(i => visitedPath.has(i.itemId)));
      if (nonCircular.length > 0) return pickBest(nonCircular);
    }
    return pickBest(singleOutput);
  }
  if (visitedPath && visitedPath.size > 0) {
    const nonCircular = pool.filter(r =>
      !(r.inputs || []).some(i => visitedPath.has(i.itemId)));
    if (nonCircular.length > 0) return pickBest(nonCircular);
  }
  return pickBest(pool);
}


/* ═══════════════════════════════════════════════
   § 4  GRAPH BUILDER

   buildBipartiteGraph constructs the recipe/item subgraph for the given
   target items. Only recipes that could plausibly contribute to satisfying
   demand for a target are included — the global recipe database (~hundreds)
   is far too large to hand wholesale to the LP.

   Three-step construction:

     Step 1 — DFS from each target.  At each item, add ALL viable recipes
              (non-dismantle, non-disposal-only) and recurse into every
              recipe's inputs.  User recipe overrides limit an item to one
              recipe.  Stop at forcedRawSet items and dead-end items.
              Multiple recipes per item enter the LP as separate variables;
              the power-weighted objective (MACHINE_PENALTY + POWER_WEIGHT ×
              facility_kw) steers the solver toward lower-power paths when
              profit is otherwise equal.

     Step 2 — Augmentation: byproduct recyclers.  Scan every recipe already
              in the graph.  For each forced-disposal output, look up all
              consuming recipes.  Any recipe that (a) has all-FD inputs and
              (b) produces at least one item already in the graph gets added.
              This is how liquid_purifier_xiranite_poly_1 enters: it eats
              lowpoly (FD output of pool_liquid) and produces lxp (already
              in graph).  The all-FD-input restriction is critical — it
              blocks alternate normal producers from sneaking in.
              Repeat until fixpoint (typically 1–2 iterations).

     Step 3 — Post-DFS cycle repair.  Compute which items are reachable from
              raw materials through the current graph.  For any item not yet
              reachable (stuck in a cycle with no raw entry), find a recipe
              NOT already in the graph whose every input is reachable-or-raw
              and inject it.  Repeat until stable.

   Graph shape:
     {
       itemNodes:      Map<itemId, { isRawMaterial: bool }>,
       recipeNodes:    Map<recipeId, recipe>,
       itemConsumedBy: Map<itemId, Set<recipeId>>,
       itemProducedBy: Map<itemId, Set<recipeId>>,
       recipeInputs:   Map<recipeId, Set<itemId>>,
       recipeOutputs:  Map<recipeId, Set<itemId>>,
       targets:        Set<itemId>,
       rawMaterials:   Set<itemId>,
     }
═══════════════════════════════════════════════ */
function buildBipartiteGraph(targetIds, recipeOverrides) {
  const graph = {
    itemNodes: new Map(),
    recipeNodes: new Map(),
    itemConsumedBy: new Map(),
    itemProducedBy: new Map(),
    recipeInputs: new Map(),
    recipeOutputs: new Map(),
    targets: new Set(targetIds),
    rawMaterials: new Set(),
  };
  const visitedItems = new Set();

  // addRecipeToGraph: register a recipe and wire up all four index maps.
  // Must be used instead of directly setting graph.recipeNodes — skipping
  // any map corrupts the graph structure silently.
  function addRecipeToGraph(recipe) {
    if (graph.recipeNodes.has(recipe.id)) return;
    graph.recipeNodes.set(recipe.id, recipe);
    graph.recipeInputs.set(recipe.id, new Set());
    graph.recipeOutputs.set(recipe.id, new Set());
    (recipe.outputs || []).forEach(out => {
      graph.recipeOutputs.get(recipe.id).add(out.itemId);
      if (!graph.itemNodes.has(out.itemId))
        graph.itemNodes.set(out.itemId, { isRawMaterial: false });
      if (!graph.itemProducedBy.has(out.itemId))
        graph.itemProducedBy.set(out.itemId, new Set());
      graph.itemProducedBy.get(out.itemId).add(recipe.id);
    });
    (recipe.inputs || []).forEach(inp => {
      graph.recipeInputs.get(recipe.id).add(inp.itemId);
      if (!graph.itemConsumedBy.has(inp.itemId))
        graph.itemConsumedBy.set(inp.itemId, new Set());
      graph.itemConsumedBy.get(inp.itemId).add(recipe.id);
    });
  }

  // Step 1 — DFS: add ALL viable recipes per item, recurse into their inputs.
  // visitedItems prevents re-entering an item already processed, which also
  // terminates natural production cycles (A→B→A) without needing a path set.
  // User recipe overrides restrict an item to the pinned recipe only.
  function traverse(itemId) {
    if (visitedItems.has(itemId)) return;
    visitedItems.add(itemId);
    const isRaw = forcedRawSet.has(itemId);
    graph.itemNodes.set(itemId, { isRawMaterial: isRaw });
    if (isRaw) { graph.rawMaterials.add(itemId); return; }

    const available = recipesByOutput[itemId] || [];
    if (available.length === 0) {
      graph.itemNodes.get(itemId).isRawMaterial = true;
      graph.rawMaterials.add(itemId);
      return;
    }

    const nonDismantle = available.filter(r => !isDismantleRecipe(r));
    const stage1 = nonDismantle.length > 0 ? nonDismantle : available;
    const nonDisposal = stage1.filter(r => !isDisposalOnlyRecipe(r));
    const pool = nonDisposal.length > 0 ? nonDisposal : stage1;

    // User override: restrict to the pinned recipe only (fall back to pool if invalid).
    const recipesToAdd = (recipeOverrides && recipeOverrides.has(itemId))
      ? [recipeById[recipeOverrides.get(itemId)] || pool[0]]
      : pool;

    for (const r of recipesToAdd) {
      if (!r) continue;
      addRecipeToGraph(r);
      (r.inputs || []).forEach(inp => traverse(inp.itemId));
    }
  }

  targetIds.forEach(id => traverse(id));

  // Step 2 — Augmentation: add FD-byproduct recycler recipes.
  // A recycler recipe satisfies both conditions:
  //   (a) isDisposalOnlyRecipe — ALL its inputs are forced-disposal items.
  //   (b) it produces at least one item already present in the graph.
  // Condition (a) is the critical guard: without it, alternate normal
  // producers (e.g. pool_xiranite_poly_2) would be added and break the
  // LP's balance equations by creating unexpected multi-producer blends.
  let added = true;
  while (added) {
    added = false;
    const snapshot = [...graph.recipeNodes.values()];
    for (const r of snapshot) {
      for (const out of (r.outputs || [])) {
        if (!forcedDisposalSet.has(out.itemId)) continue;
        const consumers = recipesByInput[out.itemId] || [];
        for (const cons of consumers) {
          if (graph.recipeNodes.has(cons.id)) continue;
          if (isDismantleRecipe(cons)) continue;
          if (!isDisposalOnlyRecipe(cons)) continue;
          const useful = (cons.outputs || []).some(o => graph.itemNodes.has(o.itemId));
          if (!useful) continue;
          addRecipeToGraph(cons);
          (cons.inputs || []).forEach(inp => traverse(inp.itemId));
          added = true;
        }
      }
    }
  }

  // Step 3 — Cycle repair (post-DFS).
  // Compute items reachable from raw materials through current recipes.
  // Any item not yet reachable is trapped in a cycle whose inputs have no
  // raw-material entry point.  Inject a viable alternate recipe (one whose
  // every input is reachable or raw) to break the cycle.  Repeat until
  // the reachable set stabilises.
  {
    const computeReachable = () => {
      const reach = new Set(graph.rawMaterials);
      let changed = true;
      while (changed) {
        changed = false;
        graph.recipeNodes.forEach(r => {
          if ((r.inputs || []).every(i => reach.has(i.itemId))) {
            (r.outputs || []).forEach(o => {
              if (!reach.has(o.itemId)) { reach.add(o.itemId); changed = true; }
            });
          }
        });
      }
      return reach;
    };

    let reachable = computeReachable();
    let anyAdded = true;
    while (anyAdded) {
      anyAdded = false;
      graph.itemNodes.forEach((info, iid) => {
        if (info.isRawMaterial || reachable.has(iid)) return;
        const viable = (recipesByOutput[iid] || []).filter(r =>
          !isDismantleRecipe(r) &&
          !isDisposalOnlyRecipe(r) &&
          !graph.recipeNodes.has(r.id) &&
          (r.inputs || []).every(i => reachable.has(i.itemId) || forcedRawSet.has(i.itemId))
        );
        if (!viable.length) return;
        for (const r of viable) {
          addRecipeToGraph(r);
          (r.inputs || []).forEach(i => traverse(i.itemId));
        }
        anyAdded = true;
      });
      if (anyAdded) reachable = computeReachable();
    }
  }

  return graph;
}


/* ═══════════════════════════════════════════════
   § 5  FLOW ANALYSIS

   Two utility functions that derive useful summaries from a solved
   recipeFacilityCounts map (recipeId → facility count).
═══════════════════════════════════════════════ */

// computeNetRatesFromFlow: from a facility-count map, compute the net
// production rate of every item (outputs minus inputs, items/min).
// Positive net = net producer; negative net = net consumer.
// Used in Phase 6 to read LP results before writing p.rate.
function computeNetRatesFromFlow(recipeFacilityCounts, graph) {
  const net = {};
  recipeFacilityCounts.forEach((fc, rid) => {
    if (fc < 1e-9) return;
    const r = graph.recipeNodes.get(rid);
    if (!r) return;
    (r.outputs || []).forEach(o => { net[o.itemId] = (net[o.itemId] || 0) + calcRate(o.amount, r.craftingTime) * fc; });
    (r.inputs  || []).forEach(i => { net[i.itemId] = (net[i.itemId] || 0) - calcRate(i.amount, r.craftingTime) * fc; });
  });
  return net;
}

// rawAndFacilityUsage: aggregate raw material consumption (per raw item) and
// facility usage (per facility type) from a facility-count map.
// Used for the Phase 5 sanity check and the usage-bars UI.
function rawAndFacilityUsage(recipeFacilityCounts, graph) {
  const rawUse = {};
  const facUse = {};
  recipeFacilityCounts.forEach((fc, rid) => {
    if (fc < 1e-9) return;
    const r = graph.recipeNodes.get(rid);
    if (!r) return;
    (r.inputs || []).forEach(i => {
      if (forcedRawSet.has(i.itemId) || (graph.itemNodes.get(i.itemId) || {}).isRawMaterial)
        rawUse[i.itemId] = (rawUse[i.itemId] || 0) + calcRate(i.amount, r.craftingTime) * fc;
    });
    facUse[r.facilityId] = (facUse[r.facilityId] || 0) + fc;
  });
  return { rawUse, facUse };
}


/* ═══════════════════════════════════════════════
   § 6  SOLVER STATE

   Variables shared between runSolver, computeSummary (in
   endfield_calculator.js), and the usage-bar renderer.
═══════════════════════════════════════════════ */

// Last solved graph and facility counts — stored so computeSummary can
// render usage bars without re-solving (used on every slider drag).
let _lastGraph = null;
let _lastFacilityCounts = null;
let _lastSolvedRates = null; // production rates at the time of the last LP solve

// RAF handle for LP throttle — ensures at most one solve per animation frame
// during continuous slider drag.
let _solverRafId = null;

// performance.now() of the most recent slider input that triggered a solve.
// Used to compute end-to-end input→render lag in the timing log.
let _lastInputT = 0;

// runSolverThrottled: debounce LP solves to one per animation frame.
// Called by slider input handlers with inPlace=true so only slider values
// are updated (no full DOM rebuild) during drag.
function runSolverThrottled(inPlace, pinAll = false) {
  if (_solverRafId) return; // already scheduled for this frame
  _solverRafId = requestAnimationFrame(() => {
    _solverRafId = null;
    runSolver(inPlace, pinAll);
  });
}

// _dragging: set during active slider drag.  Reserved for future use;
// currently no-op but keeps the flag available for optimisations.
let _dragging = false;


/* ═══════════════════════════════════════════════
   § 7  SOLVER CORE

   logS           — append a timestamped message to the solver log box.
   updateSlidersInPlace — refresh slider values from p.rate without
                    rebuilding the production list DOM.
   runSolver      — the single global LP.

   runSolver phases (matching the SOLVER_PIPELINE.md diagram):
     Phase 1 — Build bipartite graph (DFS + augment + cycle repair)
     Phase 2 — Construct LP model (balance, raw caps, facility caps,
                ub_net bounds, profit objective, surplus penalty)
     Phase 3 — Solve via HiGHS
     Phase 4 — Extract recipeFacilityCounts from x_ri values
     Phase 5 — Sanity check cap violations
     Phase 6 — Apply: snap residuals, write p.rate, render
═══════════════════════════════════════════════ */

// logS: append a line to the solver-log box with a HH:MM:SS timestamp.
// type is an optional CSS class suffix ('ok', 'err', '').
function logS(msg, type = '') {
  const box = document.getElementById('solver-log');
  if (!box) return;
  const d = document.createElement('div');
  d.className = type ? 'log-' + type : '';
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}

// updateSlidersInPlace: rewrite slider + display values from p.rate without
// rebuilding the full production-list DOM.  Called by runSolver(inPlace=true)
// during continuous slider drag so that non-fixed items reflect the LP result
// while the dragged item's slider stays under pointer control.
// Reads p.rate directly (not computeNetRatesFromFlow) so values always match
// the Phase 6 snapped result.
function updateSlidersInPlace() {
  document.querySelectorAll('.prod-item-row').forEach(row => {
    const nameEl = row.querySelector('.item-name'); if (!nameEl) return;
    const p = production.find(x => itemById[x.id]?.name === nameEl.textContent.trim()); if (!p) return;
    if (isFixed(p)) return; // fixed items own their own slider; leave it alone
    const net = Math.max(0, p.rate || 0);
    const slider = row.querySelector('.prod-slider');
    const display = row.querySelector('.prod-rate-display');
    if (slider) { slider.value = net.toFixed(6); setSliderFill(slider); }
    if (display) display.value = net.toFixed(3);
  });
}

// runSolver: single global LP — one variable per recipe, one balance
// constraint per non-raw item.  No SCC detection; the LP handles cycles
// implicitly.  No free-disposal special cases; every item gets the same
// net_production >= 0 constraint.
//
// inPlace=true:  update sliders in-place (called during slider drag via
//                runSolverThrottled); avoids full DOM rebuild.
// inPlace=false: full renderProducts() rebuild (called after state changes).
function runSolver(inPlace = false, pinAll = false) {
  const _t0 = performance.now();
  const box = document.getElementById('solver-log');
  if (box) box.innerHTML = '';
  if (!production.length) { logS('No production items.', 'err'); return; }
  if (!isHighsReady()) { _pendingSolve = { inPlace, pinAll }; return; }

  // ─── Phase 1: Build graph ────────────────────────────────────────────
  // Collect all production item IDs (deduped) and any user recipe overrides,
  // then build the bipartite graph via DFS + augmentation + cycle repair.
  const allIds = [...new Set(production.map(p => p.id))];
  const recipeOverrides = new Map(production.filter(p => p.recipeId).map(p => [p.id, p.recipeId]));
  const graph = buildBipartiteGraph(allIds, recipeOverrides);
  if (!graph.recipeNodes.size) { logS('No recipes found.', 'err'); return; }
  const _t1 = performance.now();
  logS(`Graph: ${graph.recipeNodes.size} recipes, ${graph.itemNodes.size} items`);

  // ─── Phase 1b: Pinned items ──────────────────────────────────────────
  // Fixed items (locked or tempPinnedId) produce at a user-set rate.
  // They get an equal: constraint instead of min: 0.
  // Exception: a fixed item at rate ≈ 0 is excluded from pinnedIds so the
  // LP treats it as free — locking/dragging to exactly 0 is almost always
  // unintentional and a equal: 0 equality just wastes a LP slot.
  // If the rate exceeds the computed maxRate (e.g. due to step rounding),
  // cap the equality target at maxRate so the LP stays feasible.
  // trulyFixedIds: user-locked items → get equal: constraints (unchanged).
  // pinnedIds: also includes all >0 items when pinAll=true → get equal: constraints.
  // trulyFixedIds always carries into pinAll so locked-at-0 items keep equal:0
  // and don't get produced as free co-products during the read-only solve.
  const trulyFixedIds = new Set(production.filter(isFixed).map(p => p.id));
  const pinnedIds = pinAll
    ? new Set([...production.filter(p => (p.rate || 0) > 1e-9).map(p => p.id), ...trulyFixedIds])
    : trulyFixedIds;
  const pinnedRates = new Map(production.filter(p => pinnedIds.has(p.id)).map(p => {
    const rawRate = Math.max(0, p.rate || 0);
    const mx = p.maxRate;
    return [p.id, (mx && isFinite(mx) && rawRate > mx) ? mx : rawRate];
  }));

  const productionSet = new Set(production.map(p => p.id));

  // ─── Phase 1c: singleMaxRate ───────────────────────────────────────────
  // Pre-compute per-item maximum rates via mini-LPs for every priced graph
  // item.  These become ub_net_X constraints in Phase 2 that prevent the LP
  // becoming Unbounded when self-sustaining cycles (e.g. the moss/seed loop)
  // exist without any raw or facility caps.
  //
  // _singleMaxDirty is set by invalidateMaxCache() and cleared here after a
  // full rebuild.  During drag, the flag stays false, so this block is skipped
  // entirely — single=0.0ms in the timing log confirms the fast path.
  if (_singleMaxDirty) {
    _singleMaxMap = {};
    graph.itemNodes.forEach((info, iid) => {
      if (info.isRawMaterial) return;
      if (!productionSet.has(iid)) return;
      const ck = _maxCacheKey(iid);
      if (_maxCache.has(ck)) { _singleMaxMap[iid] = _maxCache.get(ck); return; }
      const v = solveItemMax(iid, graph);
      const final = (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 1e6;
      _singleMaxMap[iid] = final;
      _maxCache.set(ck, final);
    });
    _singleMaxDirty = false;
  }
  const singleMaxRate = _singleMaxMap;
  const _t2 = performance.now();

  // ─── Phase 2: Build LP ───────────────────────────────────────────────
  // One variable x_ri per recipe (facility count, ≥ 0 by default in CPLEX LP).
  const recipeList = [...graph.recipeNodes.values()];
  const constraints = {};
  const variables = {};
  const generals = []; // x_ri names to declare as integers (MIP); populated by integerOnly facilities
  recipeList.forEach((_, ri) => { variables[`x_${ri}`] = {}; });

  // Balance constraints: net_production(item) >= 0 for every non-raw item.
  // Pinned items use equality at their locked rate so the LP honours them.
  // The net production of item X for recipe r is:
  //   output_rate(r, X) − input_rate(r, X)    [per facility per minute]
  graph.itemNodes.forEach((info, iid) => {
    if (info.isRawMaterial) return;
    const cName = `bal_${iid}`;
    let hasCoef = false;
    recipeList.forEach((r, ri) => {
      let coef = 0;
      (r.outputs || []).forEach(o => { if (o.itemId === iid) coef += calcRate(o.amount, r.craftingTime); });
      (r.inputs  || []).forEach(i => { if (i.itemId === iid) coef -= calcRate(i.amount, r.craftingTime); });
      if (Math.abs(coef) > 1e-12) {
        variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + coef;
        hasCoef = true;
      }
    });
    if (hasCoef) constraints[cName] = pinnedIds.has(iid) ? { equal: pinnedRates.get(iid) || 0 } : { min: 0 };
  });

  // Raw material caps and facility caps are skipped for pinAll solves —
  // we only want facility counts for the given rates; limits would cause
  // infeasibility when resources are fully saturated.
  if (!pinAll) {
    // Raw material caps: Σ consumption across all recipes <= user-set cap.
    rawLimits.forEach(rl => {
      const cName = `raw_${rl.matId}`;
      constraints[cName] = { max: rl.cap };
      recipeList.forEach((r, ri) => {
        const inp = (r.inputs || []).find(i => i.itemId === rl.matId);
        if (inp) variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + calcRate(inp.amount, r.craftingTime);
      });
    });

    // Facility caps: Σ facility counts <= user-set cap.
    facilityLimits.forEach(f => {
      const cName = `fac_${f.gameFacilityId}`;
      constraints[cName] = { max: f.cap };
      recipeList.forEach((r, ri) => {
        if (r.facilityId === f.gameFacilityId)
          variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + 1;
      });
    });

    // Integer-only: facility counts must be whole numbers for flagged facilities.
    facilityLimits.forEach(f => {
      if (!f.integerOnly) return;
      recipeList.forEach((r, ri) => {
        if (r.facilityId === f.gameFacilityId) generals.push(`x_${ri}`);
      });
    });
  }

  // Upper bounds on net production for every priced graph item.
  // Without these, a self-sustaining cycle (no raw/facility cap) makes the
  // profit objective unbounded.  singleMaxRate[X] is the tightest bound from
  // mini-LP or facility ceiling; mx === undefined/null/Infinity means no
  // meaningful bound so we skip the constraint entirely.
  // Note: mx=0 IS a valid bound (facility cap=0) and must NOT be skipped.
  // Skipped entirely for pinAll: all non-zero items already have equal: constraints.
  graph.itemNodes.forEach((info, iid) => {
    if (pinAll) return;
    if (info.isRawMaterial) return;
    if (pinnedIds.has(iid)) return; // pinned items are already equality-constrained
    const mx = singleMaxRate[iid];
    if (mx === undefined || mx === null || !isFinite(mx)) return;
    const cName = `ub_net_${iid}`;
    let hasCoef = false;
    recipeList.forEach((r, ri) => {
      let coef = 0;
      (r.outputs || []).forEach(o => { if (o.itemId === iid) coef += calcRate(o.amount, r.craftingTime); });
      (r.inputs  || []).forEach(i => { if (i.itemId === iid) coef -= calcRate(i.amount, r.craftingTime); });
      if (Math.abs(coef) > 1e-12) {
        variables[`x_${ri}`][cName] = (variables[`x_${ri}`][cName] || 0) + coef;
        hasCoef = true;
      }
    });
    if (hasCoef) constraints[cName] = { max: mx };
  });

  // Profit objective: Σ price(item) × net_production(item) over production targets only.
  // Intermediate items are not sold even if a price is set for them.
  // Pinned items contribute a constant (price × pinnedRate) — omitting them
  // from the objective coefficients is safe because argmax is unaffected by
  // constants.
  const TARGET_WEIGHT = getSolverWeight('target');
  // When "Prioritize Unsellable" is on, assign exponentially decreasing weights to
  // zero-price production targets in pane order so each dominates all lower-ranked
  // targets and profit (1e9 >> max_profit; ratio 1000 >> max_rate per item).
  const priorityWeightMap = new Map();
  if (!pinAll && typeof prioritizeUnsellableOn === 'function' && prioritizeUnsellableOn()) {
    let rank = 0;
    production.forEach(p => {
      if (priceOf(p.id) <= 0 && productionSet.has(p.id) && !pinnedIds.has(p.id)) {
        priorityWeightMap.set(p.id, 1e9 / Math.pow(1000, rank++));
      }
    });
  }
  graph.itemNodes.forEach((info, iid) => {
    if (info.isRawMaterial) return;
    if (pinnedIds.has(iid)) return;
    const pr = priceOf(iid);
    const effectivePrice = (pr > 0 && productionSet.has(iid)) ? pr
      : priorityWeightMap.has(iid) ? priorityWeightMap.get(iid)
      : (productionSet.has(iid) && TARGET_WEIGHT > 0 ? TARGET_WEIGHT : 0);
    if (effectivePrice <= 0) return;
    recipeList.forEach((r, ri) => {
      let coef = 0;
      (r.outputs || []).forEach(o => { if (o.itemId === iid) coef += calcRate(o.amount, r.craftingTime); });
      (r.inputs  || []).forEach(i => { if (i.itemId === iid) coef -= calcRate(i.amount, r.craftingTime); });
      if (Math.abs(coef) > 1e-12)
        variables[`x_${ri}`].profit = (variables[`x_${ri}`].profit || 0) + effectivePrice * coef;
    });
  });

  // Surplus penalty for zero-price dead-end items.
  //
  // Items produced by the LP with no downstream consumer AND no price are
  // pure waste (e.g. copper_nugget when only sewage is needed from copper
  // smelting).  Without penalty, the LP may waste raw materials generating
  // them.  A surplus variable absorbs net production; its coefficient in the
  // objective is -SURPLUS_PENALTY, nudging the LP to avoid overproducing.
  //
  // Dead-end criteria: not a production target, not priced, not consumed by
  // any recipe in the graph.  The balance constraint is promoted from >= 0
  // to = 0 so the surplus variable is the only escape valve.
  const SURPLUS_PENALTY = getSolverWeight('surplus');
  const MACHINE_PENALTY = getSolverWeight('machine');
  const POWER_WEIGHT    = getSolverWeight('power');

  // Per-facility cost: base machine penalty + optional power-proportional term.
  // Total penalty = MACHINE_PENALTY + POWER_WEIGHT * facility_power_kw.
  // This steers the LP toward lower-power paths when profit is equal.
  recipeList.forEach((r, ri) => {
    const powerKw = facilityTypeById[r.facilityId]?.power ?? 0;
    const penalty = MACHINE_PENALTY + POWER_WEIGHT * powerKw;
    if (penalty !== 0)
      variables[`x_${ri}`].profit = (variables[`x_${ri}`].profit || 0) - penalty;
  });

  const itemsConsumed = new Set();
  recipeList.forEach(r => (r.inputs || []).forEach(i => itemsConsumed.add(i.itemId)));

  graph.itemNodes.forEach((info, iid) => {
    if (info.isRawMaterial) return;
    if (pinnedIds.has(iid)) return;
    if (productionSet.has(iid)) return;   // production targets are never treated as waste
    if (priceOf(iid) > 0) return;         // priced items: profit objective already governs them
    if (itemsConsumed.has(iid)) return;   // consumed downstream: not a pure dead end
    const cName = `bal_${iid}`;
    if (!constraints[cName]) return;
    constraints[cName] = { equal: 0 };   // promote >= 0 to = 0
    const sv = `surp_${iid}`;
    variables[sv] = { [cName]: -1, profit: -SURPLUS_PENALTY };
  });

  if (window._DEBUG_LP) {
    console.group('[LP debug]');
    console.log('variables:', Object.keys(variables).length, 'constraints:', Object.keys(constraints).length);
    console.log('model:', JSON.stringify({ constraints, variables }, null, 2));
    console.groupEnd();
  }

  // ─── Phase 3: Solve ──────────────────────────────────────────────────
  // pinAll: minimise total facility count (no profit/bounds needed — just find
  // the minimal feasible solution for the equality-constrained rates).
  if (pinAll) recipeList.forEach((_, ri) => { variables[`x_${ri}`].profit = 1; });
  const model = { optimize: 'profit', opType: pinAll ? 'min' : 'max', constraints, variables, generals };
  let result;
  try { result = solveLP(model); } catch (e) { logS('LP solver error: ' + e, 'err'); return; }
  if (!result?.feasible) {
    logS('LP infeasible — check constraints.', 'err');
    if (typeof markInfeasibleItem === 'function') markInfeasibleItem(_lastChangedProdId);
    return;
  }
  if (typeof markInfeasibleItem === 'function') markInfeasibleItem(null);
  const _t3 = performance.now();

  // ─── Phase 4: Extract results ────────────────────────────────────────
  // Map each recipe's x_ri solution value to a facility count.
  // Values below 1e-9 are LP noise — treat as zero.
  const recipeFacilityCounts = new Map();
  recipeList.forEach((r, ri) => {
    const v = result[`x_${ri}`];
    recipeFacilityCounts.set(r.id, typeof v === 'number' && v > 1e-9 ? v : 0);
  });

  // ─── Phase 5: Sanity check ───────────────────────────────────────────
  // Skipped for pinAll: limits were removed from the LP intentionally.
  if (!pinAll) {
    const { rawUse, facUse } = rawAndFacilityUsage(recipeFacilityCounts, graph);
    let violation = null;
    rawLimits.forEach(rl => {
      if ((rawUse[rl.matId] || 0) > rl.cap + 0.5 && !violation)
        violation = `Raw ${rl.matId}: used ${(rawUse[rl.matId]||0).toFixed(2)}, cap ${rl.cap}`;
    });
    facilityLimits.forEach(f => {
      if ((facUse[f.gameFacilityId] || 0) > f.cap + 0.5 && !violation)
        violation = `Facility ${f.gameFacilityId}: ${(facUse[f.gameFacilityId]||0).toFixed(2)} / ${f.cap}`;
    });
    if (violation) { logS(`Constraint violation: ${violation}`, 'err'); return; }
  }

  // ─── Phase 6: Apply ──────────────────────────────────────────────────
  // Cache the solved graph and counts for computeSummary / usage bars.
  _lastGraph = graph;
  _lastFacilityCounts = recipeFacilityCounts;
  _lastSolvedRates = null; // cleared now; set after p.rate is written below

  _lastSolvedRates = Object.fromEntries(production.map(p => [p.id, p.rate]));

  if (pinAll) {
    // Read-only solve: just update summaries, don't touch production state.
    computeSummary();
    return;
  }

  // Compute net rates from the LP solution, then write p.rate.
  // Snap LP residuals below 1e-3 to exactly 0: LP arithmetic can leave tiny
  // positive values (e.g. 3.7e-7) for items the solver chose not to produce.
  // Snapping ensures sliders and the summary table always agree — without this,
  // an item "at 0" might show 0.001 on the slider during drag.
  const netRates = computeNetRatesFromFlow(recipeFacilityCounts, graph);
  production.forEach(p => {
    if (isFixed(p)) return;
    const raw = Math.max(0, netRates[p.id] || 0);
    p.rate = raw < 1e-3 ? 0 : raw;
    p.optimized = true;
  });
  _lastSolvedRates = Object.fromEntries(production.map(p => [p.id, p.rate]));

  // Log income, net (after battery cost and outpost fixed cost), and timing.
  const outpostCost = parseFloat((document.getElementById('outpost-cost')?.value||'').replace(/,/g,'')) || 0;
  const incomeHr = production.reduce((s, p) => s + priceOf(p.id) * Math.max(0, p.rate) * 60, 0);
  const batCostHr = powerBatteries.reduce((s, pb) => s + pb.rate * priceOf(pb.matId) * 60, 0);
  const netHr = incomeHr - outpostCost - batCostHr;
  logS(`Income/hr: ${fmt(incomeHr)} | Net: ${fmt(netHr)}`, 'ok');
  const _stamp = document.getElementById('solve-stamp');
  if (_stamp) _stamp.textContent = `Solved ${new Date().toLocaleTimeString()} · Net ${netHr >= 0 ? '+' : ''}${fmt(netHr)}/hr`;

  computeSummary();
  if (inPlace) updateSlidersInPlace(); else renderProducts();
  const _t4 = performance.now();
  const _lag = _lastInputT ? (_t4 - _lastInputT).toFixed(1) : '—';
  logS(`Done. graph=${(_t1-_t0).toFixed(1)}ms single=${(_t2-_t1).toFixed(1)}ms lp=${(_t3-_t2).toFixed(1)}ms render=${(_t4-_t3).toFixed(1)}ms · lag=${_lag}ms`, 'ok');
}
