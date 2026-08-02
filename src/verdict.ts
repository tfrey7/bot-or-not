// Derives the overall verdict + confidence from the per-factor scores so
// the headline number is reproducible from what's shown on the cards.
//
// Formula:
//   evidenceSum = Σ (-score × confidence), with bot contributions weighted 1.5×
//                 so a few strong red flags aren't drowned by a sea of "no signal"
//                 weak-positive factors.
//   botProbability = sigmoid(2 × evidenceSum / sqrt(Σ confidence))
//                 The sqrt(Σ confidence) normalizer keeps many correlated
//                 mid-strength factors from saturating the sigmoid — without
//                 it nearly every account reads 0.9+ "confident" regardless
//                 of how contested the evidence actually is.
//   Red-flag floor: each factor contributes a flag strength that ramps
//                   smoothly from 0 (score -0.45, confidence 0.45) to 1
//                   (score ≤ -0.6 AND confidence ≥ 0.6 — the historical
//                   step thresholds), so an LLM coin-flip between -0.59 and
//                   -0.60 no longer flips the verdict. Total strength 1
//                   floors botProbability at 0.36 (verdict ≥ uncertain),
//                   2 floors it at 0.66 (verdict ≥ likely-bot), interpolated
//                   linearly in between.
//   Ring floor: operator-curated ring membership floors botProbability at 0.85
//               (verdict ≥ bot). Claude only sees one account at a time, so
//               coordination signal can only come from the operator.
//   verdict bands map botProbability to one of the 5 labels
//   confidence = how far the probability is from a coin flip, in the verdict's direction

const BOT_EVIDENCE_WEIGHT = 1.5;
const RED_FLAG_SCORE_THRESHOLD = -0.6;
const RED_FLAG_CONFIDENCE_THRESHOLD = 0.6;
const RED_FLAG_RAMP_WIDTH = 0.15;
const RING_BOT_PROBABILITY_FLOOR = 0.85;
const SINGLE_FLAG_FLOOR = 0.36;
const DOUBLE_FLAG_FLOOR = 0.66;

// This many red flags floor botProbability at 0.66 — verdict ≥ likely-bot
// no matter what every other factor says. Exported (with isRedFlag) so the
// investigation fast-track gate tests the exact invariant the floor
// enforces instead of duplicating the thresholds.
export const RED_FLAG_LIKELY_BOT_COUNT = 2;

import type { Factor, Investigation, Verdict } from "./types.ts";

// An investigation whose status is still "running" past this threshold is
// assumed orphaned (background script restarted, network hang, etc.) and
// the UI re-enables the retry button. Needs to outlast a legit slow Claude
// call so healthy runs on heavy accounts don't flip to "stalled" while still
// in flight.
const STALE_INVESTIGATION_MS = 5 * 60 * 1000;

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

export function isRedFlag(factor: Factor): boolean {
  const score = typeof factor?.score === "number" ? factor.score : 0;
  const confidence =
    typeof factor?.confidence === "number" ? factor.confidence : 0;

  return (
    score <= RED_FLAG_SCORE_THRESHOLD &&
    confidence >= RED_FLAG_CONFIDENCE_THRESHOLD
  );
}

// 1.0 at the historical step thresholds and above; fades to 0 across
// RED_FLAG_RAMP_WIDTH below them, so near-threshold factors contribute
// partial flag strength instead of none.
function redFlagStrength(score: number, confidence: number): number {
  const rampUp = (value: number, fullAt: number): number => {
    return Math.min(
      1,
      Math.max(
        0,
        (value - (fullAt - RED_FLAG_RAMP_WIDTH)) / RED_FLAG_RAMP_WIDTH
      )
    );
  };

  const scoreStrength = rampUp(-score, -RED_FLAG_SCORE_THRESHOLD);
  const confidenceStrength = rampUp(confidence, RED_FLAG_CONFIDENCE_THRESHOLD);

  return scoreStrength * confidenceStrength;
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
  let confidenceSum = 0;
  let flagStrengthTotal = 0;

  for (const factor of factors) {
    const score = typeof factor?.score === "number" ? factor.score : 0;
    const confidence =
      typeof factor?.confidence === "number" ? factor.confidence : 0;
    const contribution = -score * confidence;
    evidenceSum +=
      contribution > 0 ? contribution * BOT_EVIDENCE_WEIGHT : contribution;
    confidenceSum += confidence;
    flagStrengthTotal += redFlagStrength(score, confidence);
  }

  const normalizedEvidence =
    evidenceSum / Math.sqrt(Math.max(1, confidenceSum));
  let botProbability = 1 / (1 + Math.exp(-2 * normalizedEvidence));

  if (flagStrengthTotal > 0) {
    const flagFloor =
      flagStrengthTotal >= 1
        ? SINGLE_FLAG_FLOOR +
          (DOUBLE_FLAG_FLOOR - SINGLE_FLAG_FLOOR) *
            Math.min(1, flagStrengthTotal - 1)
        : SINGLE_FLAG_FLOOR * flagStrengthTotal;
    botProbability = Math.max(botProbability, flagFloor);
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

// The bot-leaning half of the verdict scale. Used wherever the UI or a
// background job needs to single out "suspected bots" (the reports filter,
// the weekly status re-check) from a single, canonical definition.
export function isSuspectedBot(verdict: Verdict | null | undefined): boolean {
  return verdict === "bot" || verdict === "likely-bot";
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
