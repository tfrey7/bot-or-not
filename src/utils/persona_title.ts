// Display title for a persona. Defaults to the LLM's single-axis label, but
// when the account scores high on two archetypes at once we substitute a
// bespoke combo title (e.g. Hustler + Thirst → "Cam Hustler"). The label
// modifier class is still derived from `persona.label` so the accent color
// stays tied to the dominant archetype the LLM picked.

import { BON_ARCHETYPES } from "../factors.ts";
import type { ArchetypeKey, Persona } from "../types.ts";

const ARCHETYPE_LABELS = Object.fromEntries(
  BON_ARCHETYPES.map((archetype) => [archetype.key, archetype.label])
) as Record<ArchetypeKey, string>;

// Keys are sorted-alphabetical "a+b" so lookup doesn't depend on which axis
// happens to be highest by 0.01. Pairs not listed fall through to the
// single-axis label.
const COMBO_TITLES: Record<string, string> = {
  "farmer+stan": "Fan Acct",
  "stan+teen": "Fangirl",
  "stan+thirst": "Simp",
  "stan+zealot": "Hate-Stan",
  "hustler+stan": "Influencer",
  "doomer+stan": "Tragic Stan",
  "farmer+teen": "Karma Kid",
  "farmer+thirst": "Thirst-Trap Farm",
  "farmer+zealot": "Rage Farmer",
  "farmer+hustler": "Affiliate Spam",
  "doomer+farmer": "Doom Farmer",
  "teen+zealot": "Edgelord",
  "hustler+teen": "Teen Grindset",
  "doomer+teen": "Black-Pill Teen",
  "teen+thirst": "Spicy Teen",
  "thirst+zealot": "Toxic Lover",
  "hustler+thirst": "Cam Hustler",
  "doomer+thirst": "Lonely Heart",
  "hustler+zealot": "Grifter",
  "doomer+zealot": "Black-Pill Ranter",
  "doomer+hustler": "Crisis Grifter",
};

// Top-2 axes must both clear this threshold and the runner-up must be at
// least this fraction of the top, before we treat the persona as a blend.
// Below that, the LLM's single-axis pick is more honest than a forced combo.
// Exported so persona_color.ts can gate hue interpolation on the same rule —
// blended colors and combo titles must fire together.
export const COMBO_MIN_STRENGTH = 0.55;
export const COMBO_BALANCE_RATIO = 0.75;

function singleLabel(persona: Persona): string {
  if (persona.label === "normal") {
    return "Normal";
  }

  if (persona.label === "bot") {
    return "Bot";
  }

  return ARCHETYPE_LABELS[persona.label] || persona.label;
}

// Returns the sorted "a+b" archetype-pair key when the persona qualifies as
// a blend (both top axes >= COMBO_MIN_STRENGTH AND runner-up is at least
// COMBO_BALANCE_RATIO of the top), else null. Shared between the title and
// the icon resolver so they always agree on what counts as a blend.
export function bonPersonaComboKey(persona: Persona): string | null {
  if (!persona.archetypes) {
    return null;
  }

  const ranked = (
    Object.entries(persona.archetypes) as Array<[ArchetypeKey, number]>
  ).sort(([, a], [, b]) => b - a);
  const top = ranked[0];
  const second = ranked[1];

  if (!top || !second) {
    return null;
  }

  if (top[1] < COMBO_MIN_STRENGTH || second[1] < COMBO_MIN_STRENGTH) {
    return null;
  }

  if (second[1] / top[1] < COMBO_BALANCE_RATIO) {
    return null;
  }

  return [top[0], second[0]].sort().join("+");
}

export function bonPersonaTitle(persona: Persona): string {
  const comboKey = bonPersonaComboKey(persona);
  if (comboKey) {
    return COMBO_TITLES[comboKey] || singleLabel(persona);
  }

  return singleLabel(persona);
}
