// LLM pricing tables + cost estimation. Pure — no I/O.
//
// USD per million tokens. Verify against current provider pricing — these
// drift. Web search USD-per-request is retained for legacy investigation
// records (which used Anthropic's server-side `web_search` tool) — set to
// 0 because the live pipeline now fetches DuckDuckGo for free.

import type { ClaudeUsage } from "../types.ts";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export const BON_MODEL_PRICING: Record<string, ModelPricing> = {
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

export const BON_WEB_SEARCH_USD_PER_REQUEST = 0;

// Look up a pricing row by the model id the API echoed back. The API often
// returns a dated suffix (e.g. "claude-sonnet-4-6-20251022"); match by prefix.
export function bonLookupPricing(
  model: string | null | undefined
): ModelPricing | null {
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

// Compute USD cost for one LLM call. Returns null if the model is unknown
// so callers can distinguish "free" from "unpriced".
export function bonEstimateCostUsd(
  usage: ClaudeUsage | null | undefined,
  model: string | null | undefined,
  webSearchCount = 0
): number | null {
  const pricing = bonLookupPricing(model);
  if (!pricing || !usage) {
    return null;
  }

  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens;

  // Prefer the split if present; otherwise treat all cache creation as 5m.
  const write5mTokens = write5m != null ? write5m : cacheCreate;
  const write1hTokens = write1h != null ? write1h : 0;

  const usd =
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheRead * pricing.cacheRead +
      write5mTokens * pricing.cacheWrite5m +
      write1hTokens * pricing.cacheWrite1h) /
      1_000_000 +
    (webSearchCount || 0) * BON_WEB_SEARCH_USD_PER_REQUEST;

  return usd;
}

// Sum cost of runs in the last N days. `runs` is an array of records with a
// numeric `runAt` timestamp and `totalCost` field (as built in analytics.js).
export function bonRecentCost(
  runs: Array<{ runAt?: number | null; totalCost?: number | null }>,
  days: number
): number {
  const cutoff = Date.now() - days * 86_400_000;
  return runs
    .filter((run) => run.runAt && run.runAt >= cutoff)
    .reduce((sum, run) => sum + (run.totalCost || 0), 0);
}
