// Renders the personas scatter plot: archetype anchors around a hexagon,
// each investigated account placed at the barycentric projection of its
// archetype radar vector. Pure DOM building; data comes pre-computed from
// logic.ts.

import type { Report } from "../../types.ts";
import { ARCHETYPES } from "../../factors.ts";
import { personasHideHover, personasShowHover } from "./hover_card.ts";
import {
  PERSONAS_ANCHORS,
  type ArchetypeAnchor,
  type PersonaPoint,
} from "./logic.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

// Plot radius and label pad are in SVG units; viewBox is sized so the
// widest labels (SHILL on the left, FARMER on the right) clear the disk
// without clipping. CENTER stays at viewBox/2 so the plot remains centered.
const VIEWBOX = 680;
const CENTER = VIEWBOX / 2;
const PLOT_RADIUS = 220;
const LABEL_PAD = 38;

export interface PersonasScatterOptions {
  onSelect: (username: string) => void;
  lookupReport: (username: string) => Report | null;
}

export function personasScatter(
  points: PersonaPoint[],
  options: PersonasScatterOptions
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX} ${VIEWBOX}`);
  svg.setAttribute("class", "bon-personas-scatter");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Persona space: ${points.length} accounts plotted across ${ARCHETYPES.length} persona axes`
  );

  svg.appendChild(buildBackdrop());
  svg.appendChild(buildAxes());

  // Sort weakest-first so concentrated personas render on top — visually,
  // the strong opinions sit above the centroid haze instead of underneath.
  const sorted = [...points].sort((a, b) => a.magnitude - b.magnitude);

  for (const point of sorted) {
    svg.appendChild(buildDot(point, options));
  }

  for (const anchor of PERSONAS_ANCHORS) {
    svg.appendChild(buildAnchorLabel(anchor));
  }

  return svg;
}

// Rings are hexagonal polygons whose corners land on the archetype spokes,
// echoing the persona hexagon used elsewhere. Vertex count tracks the
// archetype count automatically via PERSONAS_ANCHORS.
function ringPoints(radius: number): string {
  return PERSONAS_ANCHORS.map(
    (anchor) => `${CENTER + anchor.x * radius},${CENTER + anchor.y * radius}`
  ).join(" ");
}

function buildBackdrop(): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "bon-personas-backdrop");

  const rings = 4;

  for (let i = 1; i <= rings; i++) {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", ringPoints((PLOT_RADIUS * i) / rings));
    polygon.setAttribute(
      "class",
      i === rings
        ? "bon-personas-ring bon-personas-ring--outer"
        : "bon-personas-ring"
    );
    group.appendChild(polygon);
  }

  return group;
}

function buildAxes(): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "bon-personas-axes");

  for (const anchor of PERSONAS_ANCHORS) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(CENTER));
    line.setAttribute("y1", String(CENTER));
    line.setAttribute("x2", String(CENTER + anchor.x * PLOT_RADIUS));
    line.setAttribute("y2", String(CENTER + anchor.y * PLOT_RADIUS));
    line.setAttribute("class", "bon-personas-axis");
    group.appendChild(line);
  }

  return group;
}

function buildAnchorLabel(anchor: ArchetypeAnchor): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "bon-personas-anchor");

  const lx = CENTER + anchor.x * (PLOT_RADIUS + LABEL_PAD);
  const ly = CENTER + anchor.y * (PLOT_RADIUS + LABEL_PAD);

  const peg = document.createElementNS(SVG_NS, "circle");
  peg.setAttribute("cx", String(CENTER + anchor.x * PLOT_RADIUS));
  peg.setAttribute("cy", String(CENTER + anchor.y * PLOT_RADIUS));
  peg.setAttribute("r", "4");
  peg.setAttribute("class", "bon-personas-peg");
  peg.setAttribute("fill", `hsl(${anchor.hue} 55% 45%)`);
  group.appendChild(peg);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(lx));
  text.setAttribute("y", String(ly));
  text.setAttribute("class", "bon-personas-anchor-label");
  text.setAttribute("fill", `hsl(${anchor.hue} 55% 38%)`);

  // Anchor labels right of the disk are left-aligned, labels left of it are
  // right-aligned, anything near top/bottom centers — keeps text from
  // overlapping the rings on either side.
  const anchorPos =
    anchor.x > 0.3 ? "start" : anchor.x < -0.3 ? "end" : "middle";
  text.setAttribute("text-anchor", anchorPos);

  // Same trick vertically so labels above/below sit above/below the peg
  // instead of crashing into it.
  const dy = anchor.y > 0.4 ? "0.85em" : anchor.y < -0.4 ? "-0.2em" : "0.35em";
  text.setAttribute("dy", dy);

  text.textContent = anchor.label;
  group.appendChild(text);

  return group;
}

function buildDot(
  point: PersonaPoint,
  options: PersonasScatterOptions
): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "bon-personas-dot");
  group.setAttribute("data-bon-username", point.username);

  if (point.isUserRated) {
    group.classList.add("bon-personas-dot--rated");
  }

  const cx = CENTER + point.x * PLOT_RADIUS;
  const cy = CENTER + point.y * PLOT_RADIUS;

  // Radius scales with magnitude — a strongly mono-archetype account reads
  // larger than a centroid haze account. Floor keeps weak signals visible.
  const r = 4 + point.magnitude * 4;

  const fill =
    point.hue !== null ? `hsl(${point.hue} 65% 52%)` : "var(--bon-muted)";

  if (point.isUserRated) {
    const halo = document.createElementNS(SVG_NS, "circle");
    halo.setAttribute("cx", String(cx));
    halo.setAttribute("cy", String(cy));
    halo.setAttribute("r", String(r + 3));
    halo.setAttribute("class", "bon-personas-dot-halo");
    group.appendChild(halo);
  }

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(cx));
  circle.setAttribute("cy", String(cy));
  circle.setAttribute("r", String(r));
  circle.setAttribute("class", "bon-personas-dot-fill");
  circle.setAttribute("fill", fill);
  group.appendChild(circle);

  // Native tooltip stays in place as a keyboard-friendly fallback / a11y
  // surface; the hover card layered above does the rich preview when a
  // pointer is in play.
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = formatTooltip(point);
  group.appendChild(title);

  const openHover = (): void => {
    const report = options.lookupReport(point.username);
    const rect = group.getBoundingClientRect();
    personasShowHover(point.username, report, rect);
  };

  group.addEventListener("click", () => options.onSelect(point.username));
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      options.onSelect(point.username);
    }
  });
  group.addEventListener("mouseenter", openHover);
  group.addEventListener("mouseleave", personasHideHover);
  group.addEventListener("focus", openHover);
  group.addEventListener("blur", personasHideHover);

  group.setAttribute("tabindex", "0");
  group.setAttribute("role", "button");
  group.setAttribute(
    "aria-label",
    `${point.username} — ${formatTooltip(point)}`
  );

  return group;
}

function formatTooltip(point: PersonaPoint): string {
  const label =
    ARCHETYPES.find((archetype) => archetype.key === point.topArchetype)
      ?.label ?? point.topArchetype;
  const pct = Math.round(point.topScore * 100);
  const ratedSuffix = point.isUserRated ? " · hand-rated" : "";
  return `u/${point.username} · ${label} ${pct}%${ratedSuffix}`;
}
