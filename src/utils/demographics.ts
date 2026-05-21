// Validation/normalization for the demographics block Claude returns.
// Lives parallel to region_inference.ts — same shape (single inferred value
// + confidence + reasoning), populated from voice / sub mix / avatar / self-
// references in the same way.

import type { AgeBand, Demographics } from "../types.ts";

const BON_AGE_BANDS: readonly AgeBand[] = [
  "teen",
  "young-adult",
  "adult",
  "older",
];

export function bonNormalizeDemographics(raw: unknown): Demographics | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const rawBand =
    typeof record.age_band === "string" ? record.age_band.trim() : "";
  const age_band = (BON_AGE_BANDS as readonly string[]).includes(rawBand)
    ? (rawBand as AgeBand)
    : null;

  const rawConfidence =
    typeof record.confidence === "number" ? record.confidence : 0;
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  const reasoning =
    typeof record.reasoning === "string" ? record.reasoning.trim() : "";

  if (!age_band && !reasoning) {
    return null;
  }

  return { age_band, confidence, reasoning };
}
