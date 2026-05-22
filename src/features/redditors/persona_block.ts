// Persona aside in the expanded investigation detail: shared radar widget
// + dominant label + a single summary paragraph below the chart. Prefers
// the investigation's overall summary; falls back to `persona.reasoning`
// for legacy records that never wrote a top-level summary. Returns null
// if the investigation has no persona data.

import type { Persona } from "../../types.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonPersonaHue } from "../../utils/persona_color.ts";
import { bonPersonaIcon } from "../../utils/persona_icon.ts";
import {
  bonHidePersonaLabel,
  bonRevealPersonaLabel,
} from "../../utils/persona_label_reveal.ts";
import {
  BON_PERSONA_RADAR_DURATION_MS,
  bonPersonaRadar,
} from "../../utils/persona_radar.ts";
import { bonPersonaTitle } from "../../utils/persona_title.ts";

export interface BonRedditorsPersonaBlockOpts {
  summary?: string | null;
}

export function bonRedditorsPersonaBlock(
  persona: Persona | null | undefined,
  options: BonRedditorsPersonaBlockOpts = {}
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

  if (persona.archetypes) {
    bonHidePersonaLabel(label);
    const radar = bonPersonaRadar(persona.archetypes, {
      iconUrl: bonPersonaIcon(persona),
    });

    if (radar) {
      block.appendChild(label);
      block.appendChild(radar);
      bonRevealPersonaLabel(label, BON_PERSONA_RADAR_DURATION_MS);
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
    summary.appendChild(bonLinkifyReddit(summaryText));
    block.appendChild(summary);
  }

  return block;
}
