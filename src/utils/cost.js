// Claude API pricing table + cost estimation. Pure — no I/O.
//
// USD per million tokens. Verify against current Anthropic pricing — these
// drift. Web search is billed per request, not per token.

(function () {
  const BON_MODEL_PRICING = {
    "claude-opus-4-7": {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite5m: 18.75,
      cacheWrite1h: 30,
    },
    "claude-sonnet-4-6": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
    },
    "claude-haiku-4-5": {
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite5m: 1.25,
      cacheWrite1h: 2,
    },
  };
  const BON_WEB_SEARCH_USD_PER_REQUEST = 0.01;

  // Look up a pricing row by the model id the API echoed back. The API often
  // returns a dated suffix (e.g. "claude-sonnet-4-6-20251022"); match by prefix.
  function bonLookupPricing(model) {
    if (!model) {
      return null;
    }
    if (BON_MODEL_PRICING[model]) {
      return BON_MODEL_PRICING[model];
    }
    for (const key of Object.keys(BON_MODEL_PRICING)) {
      if (model.startsWith(key)) {
        return BON_MODEL_PRICING[key];
      }
    }
    return null;
  }

  // Compute USD cost for one Claude call. Returns null if the model is unknown
  // so callers can distinguish "free" from "unpriced".
  function bonEstimateCostUsd(usage, model, webSearchCount = 0) {
    const p = bonLookupPricing(model);
    if (!p || !usage) {
      return null;
    }
    const inTok = usage.input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreate = usage.cache_creation_input_tokens || 0;
    const write5m = usage.cache_creation?.ephemeral_5m_input_tokens;
    const write1h = usage.cache_creation?.ephemeral_1h_input_tokens;
    // Prefer the split if present; otherwise treat all cache creation as 5m.
    const w5 = write5m != null ? write5m : cacheCreate;
    const w1 = write1h != null ? write1h : 0;
    const usd =
      (inTok * p.input +
        outTok * p.output +
        cacheRead * p.cacheRead +
        w5 * p.cacheWrite5m +
        w1 * p.cacheWrite1h) /
        1_000_000 +
      (webSearchCount || 0) * BON_WEB_SEARCH_USD_PER_REQUEST;
    return usd;
  }

  // Sum cost of runs in the last N days. `runs` is an array of records with a
  // numeric `runAt` timestamp and `totalCost` field (as built in analytics.js).
  function bonRecentCost(runs, days) {
    const cutoff = Date.now() - days * 86_400_000;
    return runs
      .filter((r) => r.runAt && r.runAt >= cutoff)
      .reduce((a, r) => a + (r.totalCost || 0), 0);
  }

  globalThis.BON_MODEL_PRICING = BON_MODEL_PRICING;
  globalThis.BON_WEB_SEARCH_USD_PER_REQUEST = BON_WEB_SEARCH_USD_PER_REQUEST;
  globalThis.bonLookupPricing = bonLookupPricing;
  globalThis.bonEstimateCostUsd = bonEstimateCostUsd;
  globalThis.bonRecentCost = bonRecentCost;
})();
