// "About the archetypes" grid shown below the persona-space scatter. Six
// cards — one per radar axis — each with a mini hexagon echoing the chart
// above: the medallion artwork clipped to the same hexagonal silhouette as
// the profile-radar widget, with the card's archetype vertex highlighted in
// its hue. Order matches BON_ARCHETYPES so the grid reads in the same
// sequence as the chart's spokes (clockwise from the top).

import type { ArchetypeKey } from "../../types.ts";
import { BON_ARCHETYPES } from "../../factors.ts";
import type { PersonaExemplars } from "./logic.ts";

import medallionStan from "../../../assets/persona-icons/noir-medallion-stan.png";
import medallionHustler from "../../../assets/persona-icons/noir-medallion-hustler.png";
import medallionFarmer from "../../../assets/persona-icons/noir-medallion-farmer.png";
import medallionDoomer from "../../../assets/persona-icons/noir-medallion-doomer.png";
import medallionCamModel from "../../../assets/persona-icons/noir-medallion-thirst.png";
import medallionZealot from "../../../assets/persona-icons/noir-medallion-zealot.png";

const SVG_NS = "http://www.w3.org/2000/svg";

// Geometry mirrors bonPersonaRadar's RADAR_LAYOUT proportions
// (radius/center ≈ 0.69) so the card hex visually echoes the profile radar
// at a smaller scale. iconScale=1.3 matches the radar too — pulls the
// medallion past the polygon's flat edges so the corner vertices land
// inside image bounds and don't clip to background.
const HEX_VIEWBOX = 100;
const HEX_CENTER = HEX_VIEWBOX / 2;
const HEX_RADIUS = 34;
const HEX_ICON_SCALE = 1.3;

// cam_model still uses the legacy "thirst" filename in assets/ — the
// archetype was renamed, the medallion art wasn't.
const BON_PERSONAS_MEDALLIONS: Record<ArchetypeKey, string> = {
  stan: medallionStan,
  hustler: medallionHustler,
  farmer: medallionFarmer,
  doomer: medallionDoomer,
  cam_model: medallionCamModel,
  zealot: medallionZealot,
};

export interface BonPersonasArchetypeGridOptions {
  exemplars: PersonaExemplars;
  onSelectUser: (username: string) => void;
}

export function bonPersonasArchetypeGrid(
  options: BonPersonasArchetypeGridOptions
): HTMLElement {
  const section = document.createElement("section");
  section.className = "bon-personas-archetypes";

  const heading = document.createElement("h3");
  heading.className = "bon-personas-archetypes-heading";
  heading.textContent = "About the personas";
  section.appendChild(heading);

  const grid = document.createElement("ul");
  grid.className = "bon-personas-archetypes-grid";

  for (const archetype of BON_ARCHETYPES) {
    grid.appendChild(buildCard(archetype.key, options));
  }

  section.appendChild(grid);

  return section;
}

function buildCard(
  key: ArchetypeKey,
  options: BonPersonasArchetypeGridOptions
): HTMLElement {
  const archetype = BON_ARCHETYPES.find((a) => a.key === key);

  if (!archetype) {
    throw new Error(`Unknown archetype key: ${key}`);
  }

  const card = document.createElement("li");
  card.className = "bon-personas-archetype-card";
  card.style.setProperty("--bon-archetype-hue", String(archetype.hue));

  card.appendChild(buildMiniHexagon(key));

  const text = document.createElement("div");
  text.className = "bon-personas-archetype-text";

  const label = document.createElement("p");
  label.className = "bon-personas-archetype-label";
  label.textContent = archetype.label;
  text.appendChild(label);

  const blurb = document.createElement("p");
  blurb.className = "bon-personas-archetype-blurb";
  blurb.textContent = archetype.blurb;
  text.appendChild(blurb);

  const exemplars = options.exemplars[key] ?? [];

  if (exemplars.length > 0) {
    text.appendChild(buildExemplarsList(exemplars, options.onSelectUser));
  }

  card.appendChild(text);

  return card;
}

function buildExemplarsList(
  exemplars: ReadonlyArray<{ username: string; score: number }>,
  onSelectUser: (username: string) => void
): HTMLElement {
  const wrap = document.createElement("p");
  wrap.className = "bon-personas-archetype-exemplars";

  const heading = document.createElement("span");
  heading.className = "bon-personas-archetype-exemplars-heading";
  heading.textContent = "Strongest examples:";
  wrap.appendChild(heading);

  exemplars.forEach((exemplar, i) => {
    if (i > 0) {
      wrap.appendChild(document.createTextNode(" · "));
    }

    const link = document.createElement("button");
    link.type = "button";
    link.className = "bon-personas-archetype-exemplar bon-pii";
    link.textContent = `u/${exemplar.username}`;
    link.title = `${Math.round(exemplar.score * 100)}% — open dossier`;
    link.addEventListener("click", () => onSelectUser(exemplar.username));
    wrap.appendChild(link);
  });

  return wrap;
}

// Mini hexagon: medallion image rendered as a <pattern> fill on a <polygon>
// whose geometry IS the clip — same technique as bonPersonaRadar's
// .bon-radar-bg, just without the radar's grid/data/animation layers. The
// vertex matching `highlight` is enlarged and filled in its archetype hue.
function buildMiniHexagon(highlight: ArchetypeKey): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${HEX_VIEWBOX} ${HEX_VIEWBOX}`);
  svg.setAttribute("class", "bon-personas-archetype-hex");
  svg.setAttribute("aria-hidden", "true");

  const vertices = BON_ARCHETYPES.map((archetype, i) => {
    const step = (Math.PI * 2) / BON_ARCHETYPES.length;
    const theta = -Math.PI / 2 + i * step;
    return {
      key: archetype.key,
      hue: archetype.hue,
      x: HEX_CENTER + Math.cos(theta) * HEX_RADIUS,
      y: HEX_CENTER + Math.sin(theta) * HEX_RADIUS,
    };
  });

  const iconRadius = HEX_RADIUS * HEX_ICON_SCALE;
  const iconSize = iconRadius * 2;
  const iconOffset = HEX_CENTER - iconRadius;
  const patternId = `bon-persona-hex-pat-${highlight}-${Math.random().toString(36).slice(2, 8)}`;

  const defs = document.createElementNS(SVG_NS, "defs");
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", patternId);
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("x", String(iconOffset));
  pattern.setAttribute("y", String(iconOffset));
  pattern.setAttribute("width", String(iconSize));
  pattern.setAttribute("height", String(iconSize));

  const image = document.createElementNS(SVG_NS, "image");
  image.setAttribute("href", BON_PERSONAS_MEDALLIONS[highlight]);
  image.setAttribute("x", "0");
  image.setAttribute("y", "0");
  image.setAttribute("width", String(iconSize));
  image.setAttribute("height", String(iconSize));
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  pattern.appendChild(image);

  defs.appendChild(pattern);
  svg.appendChild(defs);

  const points = vertices.map((v) => `${v.x},${v.y}`).join(" ");

  const fill = document.createElementNS(SVG_NS, "polygon");
  fill.setAttribute("points", points);
  fill.setAttribute("fill", `url(#${patternId})`);
  fill.setAttribute("class", "bon-personas-archetype-hex-fill");
  svg.appendChild(fill);

  const outline = document.createElementNS(SVG_NS, "polygon");
  outline.setAttribute("points", points);
  outline.setAttribute("class", "bon-personas-archetype-hex-outline");
  svg.appendChild(outline);

  for (const v of vertices) {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(v.x));
    dot.setAttribute("cy", String(v.y));

    if (v.key === highlight) {
      dot.setAttribute("r", "5.5");
      dot.setAttribute("class", "bon-personas-archetype-hex-dot--active");
      dot.setAttribute("fill", `hsl(${v.hue} 65% 52%)`);
    } else {
      dot.setAttribute("r", "2.5");
      dot.setAttribute("class", "bon-personas-archetype-hex-dot");
    }

    svg.appendChild(dot);
  }

  return svg;
}
