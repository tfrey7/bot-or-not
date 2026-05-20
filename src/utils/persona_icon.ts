// Resolves a persona to its medallion-icon URL inside the packaged extension.
// Tries the blend key first (sorted-alpha "a+b", filename uses "a_b" since
// '+' can be unstable in URL paths), then falls back to persona.label.
// Returns null if no matching icon has been shipped yet, so callers can
// render without a background gracefully.

import type { Persona } from "../types.ts";
import { bonPersonaComboKey } from "./persona_title.ts";

const KNOWN_PRIMARIES = new Set<string>([
  "stan",
  "farmer",
  "teen",
  "thirst",
  "zealot",
  "hustler",
  "doomer",
  "bot",
  "normal",
]);

const KNOWN_BLENDS = new Set<string>([
  "doomer+farmer",
  "doomer+hustler",
  "doomer+stan",
  "doomer+teen",
  "doomer+thirst",
  "doomer+zealot",
  "farmer+hustler",
  "farmer+stan",
  "farmer+teen",
  "farmer+thirst",
  "farmer+zealot",
  "hustler+stan",
  "hustler+teen",
  "hustler+thirst",
  "hustler+zealot",
  "stan+teen",
  "stan+thirst",
  "stan+zealot",
  "teen+thirst",
  "teen+zealot",
  "thirst+zealot",
]);

export function bonPersonaIcon(
  persona: Persona | null | undefined
): string | null {
  if (!persona || !persona.label) {
    return null;
  }

  const comboKey = bonPersonaComboKey(persona);
  if (comboKey && KNOWN_BLENDS.has(comboKey)) {
    const fileSlug = comboKey.replace("+", "_");
    return browser.runtime.getURL(`icons/persona/${fileSlug}.png`);
  }

  if (KNOWN_PRIMARIES.has(persona.label)) {
    return browser.runtime.getURL(`icons/persona/${persona.label}.png`);
  }

  return null;
}
