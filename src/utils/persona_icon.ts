// Resolves a persona to its medallion-icon URL inside the packaged extension.
// Tries the blend key first (sorted-alpha "a+b", filename uses "a_b" since
// '+' can be unstable in URL paths), then falls back to persona.label.
// Returns null if no matching icon has been shipped yet, so callers can
// render without a background gracefully.

import type { Persona } from "../types.ts";
import { personaComboKey } from "./persona_title.ts";

const KNOWN_PRIMARIES = new Set<string>([
  "superfan",
  "farmer",
  "cam_model",
  "politics",
  "shill",
  "doomer",
  "bot",
  "normal",
]);

const KNOWN_BLENDS = new Set<string>([
  "cam_model+doomer",
  "cam_model+farmer",
  "cam_model+politics",
  "cam_model+shill",
  "cam_model+superfan",
  "doomer+farmer",
  "doomer+politics",
  "doomer+shill",
  "doomer+superfan",
  "farmer+politics",
  "farmer+shill",
  "farmer+superfan",
  "politics+shill",
  "politics+superfan",
  "shill+superfan",
]);

export function personaIcon(
  persona: Persona | null | undefined
): string | null {
  if (!persona || !persona.label) {
    return null;
  }

  const comboKey = personaComboKey(persona);
  if (comboKey && KNOWN_BLENDS.has(comboKey)) {
    const fileSlug = comboKey.replace("+", "_");
    return browser.runtime.getURL(`icons/persona/${fileSlug}.png`);
  }

  if (KNOWN_PRIMARIES.has(persona.label)) {
    return browser.runtime.getURL(`icons/persona/${persona.label}.png`);
  }

  return null;
}
