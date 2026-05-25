// Derives the overall verdict + confidence from the per-factor scores so
// the headline number is reproducible from what's shown on the cards.
//
// Formula:
//   evidenceSum = Σ (-score × confidence), with bot contributions weighted 1.5×
//                 so a few strong red flags aren't drowned by a sea of "no signal"
//                 weak-positive factors.
//   botProbability = 1 / (1 + exp(-2 × evidenceSum))
//   Red-flag floor: any factor with score ≤ -0.6 AND confidence ≥ 0.6 is a red flag.
//                   ≥1 red flag floors botProbability at 0.36 (verdict ≥ uncertain);
//                   ≥2 red flags floor it at 0.66 (verdict ≥ likely-bot).
//   Ring floor: operator-curated ring membership floors botProbability at 0.85
//               (verdict ≥ bot). Claude only sees one account at a time, so
//               coordination signal can only come from the operator.
//   verdict bands map botProbability to one of the 5 labels
//   confidence = how far the probability is from a coin flip, in the verdict's direction

const BOT_EVIDENCE_WEIGHT = 1.5;
const RED_FLAG_SCORE_THRESHOLD = -0.6;
const RED_FLAG_CONFIDENCE_THRESHOLD = 0.6;
const RING_BOT_PROBABILITY_FLOOR = 0.85;

import type { Factor, Investigation, Verdict } from "./types.ts";

// An investigation whose status is still "running" past this threshold is
// assumed orphaned (background script restarted, network hang, etc.) and
// the UI re-enables the retry button. Needs to outlast a legit slow Claude
// call so healthy runs on heavy accounts don't flip to "stalled" while still
// in flight.
export const STALE_INVESTIGATION_MS = 5 * 60 * 1000;

export function isInvestigationStale(
  investigation: Investigation | null | undefined
): boolean {
  if (!investigation || investigation.status !== "running") {
    return false;
  }

  if (investigation.startedAt === null) {
    return true;
  }

  return Date.now() - investigation.startedAt > STALE_INVESTIGATION_MS;
}

export interface VerdictResult {
  verdict: Verdict;
  confidence: number;
  botProbability: number;
  evidenceSum: number;
}

export function computeVerdict(
  factors: Factor[],
  inRing = false
): VerdictResult {
  if (factors.length === 0) {
    return {
      verdict: "uncertain",
      confidence: 0,
      botProbability: 0.5,
      evidenceSum: 0,
    };
  }

  let evidenceSum = 0;
  let redFlagCount = 0;

  for (const factor of factors) {
    const score = typeof factor?.score === "number" ? factor.score : 0;
    const confidence =
      typeof factor?.confidence === "number" ? factor.confidence : 0;
    const contribution = -score * confidence;
    evidenceSum +=
      contribution > 0 ? contribution * BOT_EVIDENCE_WEIGHT : contribution;

    if (
      score <= RED_FLAG_SCORE_THRESHOLD &&
      confidence >= RED_FLAG_CONFIDENCE_THRESHOLD
    ) {
      redFlagCount += 1;
    }
  }

  let botProbability = 1 / (1 + Math.exp(-2 * evidenceSum));

  if (redFlagCount >= 2) {
    botProbability = Math.max(botProbability, 0.66);
  } else if (redFlagCount >= 1) {
    botProbability = Math.max(botProbability, 0.36);
  }

  if (inRing) {
    botProbability = Math.max(botProbability, RING_BOT_PROBABILITY_FLOOR);
  }

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
// from the factor math. Only "done" investigations get re-derived — other
// statuses don't have a `results` to recompute.
export function normalizeInvestigation<
  T extends Investigation | null | undefined,
>(investigation: T, inRing = false): T {
  if (!investigation || investigation.status !== "done") {
    return investigation;
  }

  if (investigation.results.factors.length === 0) {
    return investigation;
  }

  const derived = computeVerdict(investigation.results.factors, inRing);
  return {
    ...investigation,
    results: {
      ...investigation.results,
      verdict: derived.verdict,
      confidence: derived.confidence,
      botProbability: derived.botProbability,
    },
  };
}

export interface RankedFactor extends Factor {
  weight: number;
}

export interface TopReasonsSplit {
  human: RankedFactor[];
  bot: RankedFactor[];
}

// Ranks factors by decisiveness (|score| × confidence — the same weight
// computeVerdict uses for the overall verdict) and splits them by sign
// so the UI can show human-leaning and bot-leaning signals side by side.
// Neutrals and low-confidence factors are filtered out so the columns
// don't include "no signal" filler.
export function topReasonsSplit(
  factors: Factor[],
  perSide = 3
): TopReasonsSplit {
  const ranked = factors
    .filter((factor) => {
      const score = typeof factor?.score === "number" ? factor.score : 0;
      const confidence =
        typeof factor?.confidence === "number" ? factor.confidence : 0;

      return Math.abs(score) >= 0.2 && confidence >= 0.3;
    })
    .map((factor) => ({
      ...factor,
      weight: Math.abs(factor.score) * factor.confidence,
    }));

  const human = ranked
    .filter((factor) => factor.score > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, perSide);

  const bot = ranked
    .filter((factor) => factor.score < 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, perSide);

  return { human, bot };
}
