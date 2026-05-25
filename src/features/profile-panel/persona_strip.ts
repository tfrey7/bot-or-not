// The persona "card" rendered in the preview row — shared radar widget,
// dominant label, and a single summary paragraph below the chart. Prefers
// the investigation's top-level summary; falls back to `persona.reasoning`
// for legacy records. Mirrors features/persona-block/index.ts so the
// profile-page card and the reports detail pane render the same shape.

import type { Persona } from "../../types.ts";
import {
  linkifyPanelOptions,
  linkifyReddit,
} from "../../utils/linkify_reddit.ts";
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

export interface PanelPersonaStripOpts {
  summary?: string | null;
}

export function panelBuildPersonaStrip(
  persona: Persona,
  options: PanelPersonaStripOpts = {}
): HTMLElement {
  const wrap = document.createElement("aside");
  wrap.className = `bon-panel-persona bon-panel-persona--${persona.label}`;

  const hue = personaHue(persona);
  if (hue !== null) {
    wrap.style.setProperty("--bon-persona-hue", String(Math.round(hue)));
  }

  const label = document.createElement("p");
  label.className = "bon-panel-persona__label";
  label.textContent = personaTitle(persona);

  if (persona.archetypes) {
    hidePersonaLabel(label);
    const radar = personaRadar(persona.archetypes, {
      iconUrl: personaIcon(persona),
    });

    if (radar) {
      wrap.appendChild(label);
      wrap.appendChild(radar);
      revealPersonaLabel(label, PERSONA_RADAR_DURATION_MS);
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
    summary.appendChild(linkifyReddit(summaryText, linkifyPanelOptions()));
    wrap.appendChild(summary);
  }

  return wrap;
}
