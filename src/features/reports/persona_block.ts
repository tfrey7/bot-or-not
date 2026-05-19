// Persona aside in the expanded investigation detail: shared radar widget
// + dominant label + the LLM's one-line reasoning. Returns null if the
// investigation has no persona data. Legacy investigations stored before
// the radar (no `archetypes`) still render — just the label + reasoning,
// no chart.

import type { Persona } from "../../types.ts";
import { bonPersonaHue } from "../../utils/persona_color.ts";
import { bonPersonaRadar } from "../../utils/persona_radar.ts";
import { bonPersonaTitle } from "../../utils/persona_title.ts";

export function bonReportsPersonaBlock(
  persona: Persona | null | undefined
): HTMLElement | null {
  if (!persona || !persona.label) {
    return null;
  }

  const block = document.createElement("aside");
  block.className = `bon-persona bon-persona--${persona.label}`;

  const hue = bonPersonaHue(persona);
  if (hue !== null) {
    block.style.setProperty("--bon-persona-hue", String(Math.round(hue)));
  }

  const label = document.createElement("p");
  label.className = `bon-persona-label bon-persona-label--${persona.label}`;
  label.textContent = bonPersonaTitle(persona);
  block.appendChild(label);

  if (persona.archetypes) {
    const radar = bonPersonaRadar(persona.archetypes);
    if (radar) {
      block.appendChild(radar);
    }
  }

  if (persona.reasoning) {
    const blurb = document.createElement("p");
    blurb.className = "bon-persona-blurb";
    blurb.textContent = persona.reasoning;
    block.appendChild(blurb);
  }
  return block;
}
