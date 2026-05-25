// LLM pricing tables + cost estimation. Pure — no I/O.
//
// USD per million tokens. Verify against current provider pricing — these
// drift.

import type { ClaudeUsage } from "../types.ts";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
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

  // OpenAI prompt caching is automatic — no explicit "write" charge, so
  // cacheWrite5m/1h equal the normal input rate. Cached reads get the
  // discounted `cacheRead` rate. Verify against openai.com/api/pricing.
  "gpt-4o": {
    input: 2.5,
    output: 10,
    cacheRead: 1.25,
    cacheWrite5m: 2.5,
    cacheWrite1h: 2.5,
  },
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.075,
    cacheWrite5m: 0.15,
    cacheWrite1h: 0.15,
  },
  "gpt-4.1": {
    input: 2,
    output: 8,
    cacheRead: 0.5,
    cacheWrite5m: 2,
    cacheWrite1h: 2,
  },
  "gpt-4.1-mini": {
    input: 0.4,
    output: 1.6,
    cacheRead: 0.1,
    cacheWrite5m: 0.4,
    cacheWrite1h: 0.4,
  },
};

// Look up a pricing row by the model id the API echoed back. The API often
// returns a dated suffix (e.g. "claude-sonnet-4-6-20251022"); match by prefix.
export function lookupPricing(
  model: string | null | undefined
): ModelPricing | null {
  if (!model) {
    return null;
  }

  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key)) {
      return MODEL_PRICING[key];
    }
  }

  return null;
}

// Compute USD cost for one LLM call. Returns null if the model is unknown
// so callers can distinguish "free" from "unpriced".
export function estimateCostUsd(
  usage: ClaudeUsage | null | undefined,
  model: string | null | undefined
): number | null {
  const pricing = lookupPricing(model);
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

  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheRead * pricing.cacheRead +
      write5mTokens * pricing.cacheWrite5m +
      write1hTokens * pricing.cacheWrite1h) /
    1_000_000
  );
}

// Sum cost of runs in the last N days. `runs` is an array of records with a
// numeric `runAt` timestamp and `totalCost` field (as built in analytics.js).
export function recentCost(
  runs: Array<{ runAt?: number | null; totalCost?: number | null }>,
  days: number
): number {
  const cutoff = Date.now() - days * 86_400_000;
  return runs
    .filter((run) => run.runAt && run.runAt >= cutoff)
    .reduce((sum, run) => sum + (run.totalCost || 0), 0);
}
