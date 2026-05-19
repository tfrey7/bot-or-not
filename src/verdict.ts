// Derives the overall verdict + confidence from the per-factor scores so
// the headline number is reproducible from what's shown on the cards.
//
// Formula:
//   evidenceSum = Σ (-score × confidence)  // positive = bot evidence
//   botProbability = 1 / (1 + exp(-2 × evidenceSum))
//   verdict bands map botProbability to one of the 5 labels
//   confidence = how far the probability is from a coin flip, in the verdict's direction

import type { Factor, Investigation, Verdict } from "./types.ts";

// An investigation whose status is still "running" past this threshold is
// assumed orphaned (background script restarted, network hang, etc.) and
// the UI re-enables the retry button. Tracks BON_CLAUDE_TIMEOUT_MS in
// bot_analysis.js — needs to outlast a legit slow Claude call so healthy
// runs on heavy accounts don't flip to "stalled" while still in flight.
export const BON_STALE_INVESTIGATION_MS = 5 * 60 * 1000;

export function bonIsInvestigationStale(
  investigation: Investigation | null | undefined
): boolean {
  if (!investigation || investigation.status !== "running") {
    return false;
  }

  if (investigation.startedAt === null) {
    return true;
  }

  return Date.now() - investigation.startedAt > BON_STALE_INVESTIGATION_MS;
}

export interface VerdictResult {
  verdict: Verdict;
  confidence: number;
  botProbability: number;
  evidenceSum: number;
}

export function bonComputeVerdict(factors: Factor[]): VerdictResult {
  if (factors.length === 0) {
    return {
      verdict: "uncertain",
      confidence: 0,
      botProbability: 0.5,
      evidenceSum: 0,
    };
  }

  let evidenceSum = 0;
  for (const factor of factors) {
    const score = typeof factor?.score === "number" ? factor.score : 0;
    const confidence =
      typeof factor?.confidence === "number" ? factor.confidence : 0;
    evidenceSum += -score * confidence;
  }
  const botProbability = 1 / (1 + Math.exp(-2 * evidenceSum));

  let verdict: Verdict;
  if (botProbability >= 0.85) {
    verdict = "bot";
  } else if (botProbability >= 0.65) {
    verdict = "likely-bot";
  } else if (botProbability > 0.35) {
    verdict = "uncertain";
  } else if (botProbability > 0.15) {
    verdict = "likely-human";
  } else {
    verdict = "human";
  }

  const confidence = Math.max(botProbability, 1 - botProbability);
  return { verdict, confidence, botProbability, evidenceSum };
}

// Returns a shallow copy of `investigation` with verdict/confidence overridden
// from the factor math. Leaves status: "running" / "error" untouched.
export function bonNormalizeInvestigation<
  T extends Investigation | null | undefined,
>(investigation: T): T {
  if (!investigation) {
    return investigation;
  }
  if (investigation.status === "running" || investigation.status === "error") {
    return investigation;
  }
  if (investigation.factors.length === 0) {
    return investigation;
  }

  const derived = bonComputeVerdict(investigation.factors);
  return {
    ...investigation,
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
  };
}

export interface RankedFactor extends Factor {
  weight: number;
}

// Ranks factors by decisiveness (|score| × confidence — the same weight
// bonComputeVerdict uses for the overall verdict) and returns the top N
// that carried real signal. Neutrals and low-confidence factors are filtered
// out so the bullets don't include "no signal" filler.
export function bonTopReasons(factors: Factor[], count = 3): RankedFactor[] {
  return factors
    .filter((factor) => {
      const score = typeof factor?.score === "number" ? factor.score : 0;
      const confidence =
        typeof factor?.confidence === "number" ? factor.confidence : 0;
      return Math.abs(score) >= 0.2 && confidence >= 0.3;
    })
    .map((factor) => ({
      ...factor,
      weight: Math.abs(factor.score) * factor.confidence,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count);
}
