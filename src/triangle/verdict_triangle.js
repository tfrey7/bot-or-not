// Triangle classifier aggregator (beta).
//
// Takes per-factor triangle scores returned by bot_analysis_triangle.js and
// reduces them to a single { bot, stan, farmer } blend that the widget renders.
//
// Formula (per corner C):
//   numerator   = Σ over factors with C ∈ vertices: factor.C × factor.confidence
//   denominator = Σ over factors with C ∈ vertices: factor.confidence
//   weight[C]   = numerator / denominator    (0 if no eligible signal)
//
// A confidence-weighted average over the factors *eligible* for each corner.
// This handles the asymmetry in `factors.js` where Bot has many more eligible
// factors than Stan or Farmer — each corner is judged against its own pool.
//
// Output values are in [0, 1]. The triangle widget normalizes them barycentrically
// for dot placement, so {0.1, 0.1, 0.1} (all weak) lands at the centroid (Normal),
// {0.8, 0.1, 0.1} pulls toward Bot, etc.

(function () {
  function bonComputeTriangle(factors) {
    const empty = { bot: 0, stan: 0, farmer: 0 };
    if (!Array.isArray(factors) || factors.length === 0) return empty;
    if (typeof BON_FACTORS === "undefined") return empty;

    const byKey = new Map(factors.map((f) => [f?.key, f]).filter(([k]) => k));
    const numer = { bot: 0, stan: 0, farmer: 0 };
    const denom = { bot: 0, stan: 0, farmer: 0 };

    for (const fdef of BON_FACTORS) {
      const f = byKey.get(fdef.key);
      if (!f) continue;
      const conf = typeof f.confidence === "number" ? f.confidence : 0;
      if (conf <= 0) continue;
      for (const v of fdef.triangleVertices) {
        const s = typeof f[v] === "number" ? f[v] : 0;
        numer[v] += s * conf;
        denom[v] += conf;
      }
    }

    return {
      bot: denom.bot > 0 ? numer.bot / denom.bot : 0,
      stan: denom.stan > 0 ? numer.stan / denom.stan : 0,
      farmer: denom.farmer > 0 ? numer.farmer / denom.farmer : 0,
    };
  }

  globalThis.bonComputeTriangle = bonComputeTriangle;
})();
