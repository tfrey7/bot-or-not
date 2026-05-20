// The persona "card" rendered in the preview row — shared radar widget,
// dominant label, and a single summary paragraph below the chart. Prefers
// the investigation's top-level summary; falls back to `persona.reasoning`
// for legacy records. Mirrors features/reports/persona_block.ts so the
// profile-page card and the reports detail pane render the same shape.

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

export interface BonPanelPersonaStripOpts {
  summary?: string | null;
}

export function bonPanelBuildPersonaStrip(
  persona: Persona,
  options: BonPanelPersonaStripOpts = {}
): HTMLElement {
  const wrap = document.createElement("aside");
  wrap.className = `bon-panel-persona bon-panel-persona--${persona.label}`;

  const hue = bonPersonaHue(persona);
  if (hue !== null) {
    wrap.style.setProperty("--bon-persona-hue", String(Math.round(hue)));
  }

  const label = document.createElement("p");
  label.className = "bon-panel-persona__label";
  label.textContent = bonPersonaTitle(persona);

  if (persona.archetypes) {
    bonHidePersonaLabel(label);
    const radar = bonPersonaRadar(persona.archetypes, {
      iconUrl: bonPersonaIcon(persona),
    });

    if (radar) {
      wrap.appendChild(label);
      wrap.appendChild(radar);
      bonRevealPersonaLabel(label, BON_PERSONA_RADAR_DURATION_MS);
    } else {
      wrap.appendChild(label);
    }
  } else {
    wrap.appendChild(label);
  }

  const summaryText = options.summary ?? persona.reasoning;
  if (summaryText) {
    const summary = document.createElement("p");
    summary.className = "bon-panel-persona__summary";
    summary.appendChild(bonLinkifyReddit(summaryText));
    wrap.appendChild(summary);
  }

  return wrap;
}
