// Validation/normalization for the region block Claude returns.

import { BON_REGION_INFO } from "../features/regions";
import type { RegionInferenceAi } from "../types.ts";

export function bonNormalizeRegionInference(
  raw: unknown
): RegionInferenceAi | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const rawCode = typeof record.code === "string" ? record.code.trim() : "";
  const code = rawCode && BON_REGION_INFO[rawCode] ? rawCode : null;

  const rawConfidence =
    typeof record.confidence === "number" ? record.confidence : 0;
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  const reasoning =
    typeof record.reasoning === "string" ? record.reasoning.trim() : "";

  if (!code && !reasoning) {
    return null;
  }

  return { code, confidence, reasoning };
}
