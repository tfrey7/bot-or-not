// Persona stamp shown alongside the region badge and AI verdict in the
// combined Tags column. Mirrors the rubber-stamp look of the verdict
// badge but tints with the persona's archetype hue, matching the radar
// accent on the detail pane. Returns null for absent personas so the
// tag strip silently omits it.

import type { Persona } from "../../types.ts";
import { bonPersonaHue } from "../../utils/persona_color.ts";
import { bonPersonaTitle } from "../../utils/persona_title.ts";

export function bonRedditorsPersonaTag(
  persona: Persona | null | undefined
): HTMLSpanElement | null {
  if (!persona || !persona.label) {
    return null;
  }

  const title = bonPersonaTitle(persona);
  if (!title) {
    return null;
  }

  const tag = document.createElement("span");
  tag.className = `bon-persona-tag bon-persona-tag--${persona.label}`;
  tag.textContent = title;

  const hue = bonPersonaHue(persona);
  if (hue !== null) {
    tag.style.setProperty("--bon-persona-hue", String(Math.round(hue)));
  }

  if (persona.reasoning) {
    tag.title = persona.reasoning;
  }

  return tag;
}
