// The persona "card" rendered to the right of the preview summary —
// shared radar widget + dominant label + reasoning blurb. Same shape
// as the reports detail pane's persona block.

import type { Persona } from "../../types.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonPersonaHue } from "../../utils/persona_color.ts";
import { bonPersonaRadar } from "../../utils/persona_radar.ts";
import { bonPersonaTitle } from "../../utils/persona_title.ts";

export function bonPanelBuildPersonaStrip(persona: Persona): HTMLElement {
  const wrap = document.createElement("aside");
  wrap.className = `bon-panel-persona bon-panel-persona--${persona.label}`;

  const hue = bonPersonaHue(persona);
  if (hue !== null) {
    wrap.style.setProperty("--bon-persona-hue", String(Math.round(hue)));
  }

  const label = document.createElement("p");
  label.className = "bon-panel-persona__label";
  label.textContent = bonPersonaTitle(persona);
  wrap.appendChild(label);

  if (persona.archetypes) {
    const radar = bonPersonaRadar(persona.archetypes);
    if (radar) {
      wrap.appendChild(radar);
    }
  }

  if (persona.reasoning) {
    const blurb = document.createElement("p");
    blurb.className = "bon-panel-persona__blurb";
    blurb.appendChild(bonLinkifyReddit(persona.reasoning));
    wrap.appendChild(blurb);
  }

  return wrap;
}
