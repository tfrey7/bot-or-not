// Persona aside in the expanded investigation detail: shared radar widget
// + dominant label + a single summary paragraph below the chart. Prefers
// the investigation's overall summary; falls back to `persona.reasoning`
// for legacy records that never wrote a top-level summary. Returns null
// if the investigation has no persona data.

import type { Persona } from "../../types.ts";
import { linkifyReddit } from "../../utils/linkify_reddit.ts";
import { personaHue } from "../../utils/persona_color.ts";
import { personaIcon } from "../../utils/persona_icon.ts";
import {
  hidePersonaLabel,
  revealPersonaLabel,
} from "../../utils/persona_label_reveal.ts";
import {
  PERSONA_RADAR_DURATION_MS,
  personaRadar,
} from "../../utils/persona_radar.ts";
import { personaTitle } from "../../utils/persona_title.ts";

export interface PersonaBlockOpts {
  summary?: string | null;
}

export function buildPersonaBlock(
  persona: Persona | null | undefined,
  options: PersonaBlockOpts = {}
): HTMLElement | null {
  if (!persona || !persona.label) {
    return null;
  }

  const block = document.createElement("aside");
  block.className = `bon-persona bon-persona--${persona.label}`;

  const hue = personaHue(persona);
  if (hue !== null) {
    block.style.setProperty("--bon-persona-hue", String(Math.round(hue)));
  }

  const label = document.createElement("p");
  label.className = `bon-persona-label bon-persona-label--${persona.label}`;
  label.textContent = personaTitle(persona);

  if (persona.archetypes) {
    hidePersonaLabel(label);
    const radar = personaRadar(persona.archetypes, {
      iconUrl: personaIcon(persona),
    });

    if (radar) {
      block.appendChild(label);
      block.appendChild(radar);
      revealPersonaLabel(label, PERSONA_RADAR_DURATION_MS);
    } else {
      block.appendChild(label);
    }
  } else {
    block.appendChild(label);
  }

  const summaryText = options.summary ?? persona.reasoning;
  if (summaryText) {
    const summary = document.createElement("p");
    summary.className = "bon-persona-summary";
    summary.appendChild(linkifyReddit(summaryText));
    block.appendChild(summary);
  }

  return block;
}
