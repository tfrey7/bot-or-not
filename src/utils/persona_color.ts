// Hue on the HSL color wheel for a persona. When the top two archetype scores
// both clear the combo threshold, the hue is interpolated along the shorter
// arc — so a Cam Hustler (hustler 155° + thirst 320°) lands between teal and
// magenta. Returns null for personas that don't map to an archetype (bot,
// normal) — those fall back to a neutral CSS rule on the card.

import { BON_ARCHETYPES } from "../factors.ts";
import type { ArchetypeKey, Persona } from "../types.ts";
import { COMBO_BALANCE_RATIO, COMBO_MIN_STRENGTH } from "./persona_title.ts";

const ARCHETYPE_HUE = Object.fromEntries(
  BON_ARCHETYPES.map((archetype) => [archetype.key, archetype.hue])
) as Record<ArchetypeKey, number>;

function interpolateHue(h1: number, h2: number, t: number): number {
  let diff = h2 - h1;
  if (diff > 180) {
    diff -= 360;
  }
  if (diff < -180) {
    diff += 360;
  }
  const result = h1 + diff * t;
  return ((result % 360) + 360) % 360;
}

export function bonPersonaHue(persona: Persona): number | null {
  if (!persona.archetypes) {
    return ARCHETYPE_HUE[persona.label as ArchetypeKey] ?? null;
  }

  const ranked = (
    Object.entries(persona.archetypes) as Array<[ArchetypeKey, number]>
  ).sort(([, a], [, b]) => b - a);
  const top = ranked[0];
  if (!top || top[1] <= 0.05) {
    return ARCHETYPE_HUE[persona.label as ArchetypeKey] ?? null;
  }

  const second = ranked[1];
  if (
    !second ||
    top[1] < COMBO_MIN_STRENGTH ||
    second[1] < COMBO_MIN_STRENGTH ||
    second[1] / top[1] < COMBO_BALANCE_RATIO
  ) {
    return ARCHETYPE_HUE[top[0]];
  }

  const weight = second[1] / (top[1] + second[1]);
  return interpolateHue(
    ARCHETYPE_HUE[top[0]],
    ARCHETYPE_HUE[second[0]],
    weight
  );
}
