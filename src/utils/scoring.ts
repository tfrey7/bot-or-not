// Display-side scoring helpers — coarse buckets derived from numeric values.
// The authoritative verdict math lives in verdict.js; these are just display
// classifications used by tags and the activity heatmap.

import type { FactorLeaning } from "../types.ts";

// Maps a per-factor (score, confidence) pair to a coarse leaning label used
// for CSS classes on the per-factor cards.
export function bonScoreLeaning(
  score: number | null | undefined,
  confidence: number | null | undefined
): FactorLeaning {
  if (typeof score !== "number") {
    return "neutral";
  }

  if (typeof confidence === "number" && confidence < 0.2) {
    return "neutral";
  }

  if (score <= -0.5) {
    return "bot";
  }

  if (score <= -0.2) {
    return "likely-bot";
  }

  if (score >= 0.5) {
    return "human";
  }

  if (score >= 0.2) {
    return "likely-human";
  }

  return "neutral";
}

// Bucket an activity count into one of 6 heatmap intensity levels (0–5).
export function bonBucketLevel(count: number): number {
  if (count <= 0) {
    return 0;
  }

  if (count === 1) {
    return 1;
  }

  if (count <= 3) {
    return 2;
  }

  if (count <= 6) {
    return 3;
  }

  if (count <= 10) {
    return 4;
  }

  return 5;
}
