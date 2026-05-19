// Validation/normalization for the persona block Claude returns.

import { BON_ARCHETYPE_KEYS, BON_PERSONA_LABELS } from "../factors.ts";
import type { ArchetypeKey, Persona, PersonaLabel } from "../types.ts";

// Validates the persona block from Claude's response. Returns null when the
// model omits it or returns a label outside the allowed enum — UI then falls
// back to no-persona rendering instead of inventing a label from the verdict.
//
// `archetypes` is the per-axis 0–1 score map that powers the radar chart.
// Axis list is the canonical one in factors.js so reports.js can trust the
// shape: every known axis present, clamped to [0,1], or null for legacy data.
export function bonNormalizePersona(raw: unknown): Persona | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const label = String(record.label || "")
    .toLowerCase()
    .trim();

  if (!(BON_PERSONA_LABELS as readonly string[]).includes(label)) {
    return null;
  }

  const reasoning =
    typeof record.reasoning === "string" ? record.reasoning.trim() : "";

  return {
    label: label as PersonaLabel,
    reasoning,
    archetypes: bonNormalizeArchetypes(record.archetypes),
  };
}

export function bonNormalizeArchetypes(
  raw: unknown
): Record<ArchetypeKey, number> | null {
  const out = {} as Record<ArchetypeKey, number>;
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  let anyPresent = false;

  for (const axis of BON_ARCHETYPE_KEYS) {
    const value = source[axis];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[axis] = Math.max(0, Math.min(1, value));
      anyPresent = true;
    } else {
      out[axis] = 0;
    }
  }

  // Legacy investigations (and any pre-archetype model output) have no axes —
  // return null so the renderer can fall back to the text-only persona panel
  // instead of drawing a flat zero radar.
  return anyPresent ? out : null;
}
