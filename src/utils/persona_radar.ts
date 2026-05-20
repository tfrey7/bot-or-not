// Shared radar widget rendering the seven archetype strengths.
// Both the reports detail pane and the Reddit profile panel call this
// so the chart is visually identical across surfaces. Vertices start at
// 12 o'clock and walk clockwise through BON_ARCHETYPES — the chart grows
// automatically if an archetype is added. Fill/stroke pull from
// --bon-persona-accent set on an ancestor.

import { BON_ARCHETYPES } from "../factors.ts";
import type { ArchetypeKey } from "../types.ts";

const RADAR_LAYOUT = {
  size: 220,
  center: 110,
  radius: 76,
  labelPad: 14,
  gridLevels: 4,
};

// Floor for the filled polygon's vertices so a strongly mono-archetype
// persona still reads as a shape (a blade pointing to the spike) instead
// of a degenerate line through the center. Dots and tooltips use the
// true score — only the visible polygon gets the baseline.
const POLY_FLOOR = 0.06;

// Race-out animation tuning. Each vertex starts at the center and races
// to its target; successive vertices fire on a clockwise stagger from
// 12 o'clock, so the shape "grows" instead of popping into existence.
const ANIM_VERTEX_MS = 360;
const ANIM_STAGGER_MS = 70;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;

// Persona medallion fade-in target. Matches the CSS rest opacity on
// `.bon-radar-bg` — kept in sync here.
const BG_FADE_FINAL_OPACITY = 0.45;

// Exported so the persona label's reveal animation can match the
// radar's total runtime — bg fade, spider race-out, and label glow all
// start and end on the same beat. Derived from the archetype count so
// it auto-tracks if axes are added.
export const BON_PERSONA_RADAR_DURATION_MS =
  (BON_ARCHETYPES.length - 1) * ANIM_STAGGER_MS + ANIM_VERTEX_MS;

export interface BonPersonaRadarOptions {
  iconUrl?: string | null;
}

export function bonPersonaRadar(
  archetypes: Record<ArchetypeKey, number>,
  options: BonPersonaRadarOptions = {}
): HTMLDivElement | null {
  const svgns = "http://www.w3.org/2000/svg";
  const layout = RADAR_LAYOUT;
  const axes = BON_ARCHETYPES;
  const N = axes.length;

  if (N < 3) {
    return null;
  }

  const step = (Math.PI * 2) / N;
  const angle = (i: number): number => -Math.PI / 2 + i * step;

  const vertex = (i: number, scale: number): { x: number; y: number } => {
    const t = angle(i);
    return {
      x: layout.center + layout.radius * scale * Math.cos(t),
      y: layout.center + layout.radius * scale * Math.sin(t),
    };
  };

  const points = (scale: number): string =>
    axes
      .map((_, i) => {
        const point = vertex(i, scale);
        return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
      })
      .join(" ");

  const wrap = document.createElement("div");
  wrap.className = "bon-persona-radar";
  wrap.title = axes
    .map(
      (axis) =>
        `${axis.label} ${Math.round((archetypes[axis.key] || 0) * 100)}%`
    )
    .join("  ·  ");

  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", `0 0 ${layout.size} ${layout.size}`);
  svg.setAttribute("class", "bon-radar");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Persona radar: ${axes
      .map(
        (axis) =>
          `${axis.label} ${Math.round((archetypes[axis.key] || 0) * 100)}%`
      )
      .join(", ")}`
  );

  let bgPoly: SVGPolygonElement | null = null;
  if (options.iconUrl) {
    // Render the medallion as a <pattern> fill on the same heptagonal
    // <polygon> the radar's outer grid uses. The polygon's geometry IS the
    // clip, so the silhouette is cropped exactly to the radar's outer ring
    // — no clip-path attribute (those are unreliable on SVG <image>), no
    // bleed into the curve gaps a circular clip would leave behind.
    const iconScale = 1.3;
    const iconRadius = layout.radius * iconScale;
    const iconSize = iconRadius * 2;
    const iconOffset = layout.center - iconRadius;
    const patternId = `bon-radar-bg-pat-${Math.random().toString(36).slice(2, 8)}`;

    const defs = document.createElementNS(svgns, "defs");
    const pattern = document.createElementNS(svgns, "pattern");
    pattern.setAttribute("id", patternId);
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("x", String(iconOffset));
    pattern.setAttribute("y", String(iconOffset));
    pattern.setAttribute("width", String(iconSize));
    pattern.setAttribute("height", String(iconSize));

    const patternImage = document.createElementNS(svgns, "image");
    patternImage.setAttribute("href", options.iconUrl);
    patternImage.setAttribute("x", "0");
    patternImage.setAttribute("y", "0");
    patternImage.setAttribute("width", String(iconSize));
    patternImage.setAttribute("height", String(iconSize));
    patternImage.setAttribute("preserveAspectRatio", "xMidYMid meet");
    pattern.appendChild(patternImage);

    defs.appendChild(pattern);
    svg.appendChild(defs);

    bgPoly = document.createElementNS(svgns, "polygon");
    bgPoly.setAttribute("points", points(1));
    bgPoly.setAttribute("fill", `url(#${patternId})`);
    bgPoly.setAttribute("class", "bon-radar-bg");
    svg.appendChild(bgPoly);
  }

  for (let g = 1; g <= layout.gridLevels; g++) {
    const poly = document.createElementNS(svgns, "polygon");
    poly.setAttribute("points", points(g / layout.gridLevels));
    poly.setAttribute(
      "class",
      g === layout.gridLevels
        ? "bon-radar-grid bon-radar-grid--outer"
        : "bon-radar-grid"
    );
    svg.appendChild(poly);
  }

  for (let i = 0; i < N; i++) {
    const point = vertex(i, 1);
    const line = document.createElementNS(svgns, "line");
    line.setAttribute("x1", String(layout.center));
    line.setAttribute("y1", String(layout.center));
    line.setAttribute("x2", point.x.toFixed(2));
    line.setAttribute("y2", point.y.toFixed(2));
    line.setAttribute("class", "bon-radar-axis");
    svg.appendChild(line);
  }

  const polyTargets = axes.map((axis, i) => {
    const score = Math.max(0, Math.min(1, archetypes[axis.key] || 0));
    return vertex(i, Math.max(score, POLY_FLOOR));
  });

  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const formatPolyPoints = (
    pts: ReadonlyArray<{ x: number; y: number }>
  ): string =>
    pts.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

  const centerPoints = polyTargets.map(() => ({
    x: layout.center,
    y: layout.center,
  }));

  const dataPoly = document.createElementNS(svgns, "polygon");
  dataPoly.setAttribute(
    "points",
    formatPolyPoints(reduceMotion ? polyTargets : centerPoints)
  );
  dataPoly.setAttribute("class", "bon-radar-data");
  svg.appendChild(dataPoly);

  const dotTargets: Array<{
    el: SVGCircleElement;
    axisIndex: number;
    tx: number;
    ty: number;
  }> = [];

  for (let i = 0; i < N; i++) {
    const score = archetypes[axes[i].key] || 0;
    if (score <= 0.05) {
      continue;
    }

    const point = vertex(i, score);
    const dot = document.createElementNS(svgns, "circle");
    const startX = reduceMotion ? point.x : layout.center;
    const startY = reduceMotion ? point.y : layout.center;
    dot.setAttribute("cx", startX.toFixed(2));
    dot.setAttribute("cy", startY.toFixed(2));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "bon-radar-dot");
    svg.appendChild(dot);

    dotTargets.push({ el: dot, axisIndex: i, tx: point.x, ty: point.y });
  }

  if (bgPoly && !reduceMotion) {
    bgPoly.style.opacity = "0";
  }

  if (
    !reduceMotion &&
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    const totalDuration = BON_PERSONA_RADAR_DURATION_MS;
    let startTime: number | null = null;

    const tick = (now: number): void => {
      if (startTime === null) {
        startTime = now;
      }

      const elapsed = now - startTime;

      if (bgPoly) {
        const bgT = Math.max(0, Math.min(1, elapsed / totalDuration));
        bgPoly.style.opacity = (
          easeInCubic(bgT) * BG_FADE_FINAL_OPACITY
        ).toFixed(3);
      }

      const liveVertices = polyTargets.map((target, i) => {
        const vertexStart = i * ANIM_STAGGER_MS;
        const localT = Math.max(
          0,
          Math.min(1, (elapsed - vertexStart) / ANIM_VERTEX_MS)
        );
        const eased = easeOutCubic(localT);
        return {
          x: layout.center + (target.x - layout.center) * eased,
          y: layout.center + (target.y - layout.center) * eased,
        };
      });
      dataPoly.setAttribute("points", formatPolyPoints(liveVertices));

      for (const dot of dotTargets) {
        const vertexStart = dot.axisIndex * ANIM_STAGGER_MS;
        const localT = Math.max(
          0,
          Math.min(1, (elapsed - vertexStart) / ANIM_VERTEX_MS)
        );
        const eased = easeOutCubic(localT);
        const x = layout.center + (dot.tx - layout.center) * eased;
        const y = layout.center + (dot.ty - layout.center) * eased;
        dot.el.setAttribute("cx", x.toFixed(2));
        dot.el.setAttribute("cy", y.toFixed(2));
      }

      if (elapsed < totalDuration) {
        window.requestAnimationFrame(tick);
      } else if (bgPoly) {
        // Hand opacity back to the stylesheet so the hover-to-peek
        // CSS rule (label:hover ~ radar .bg) can override at rest.
        bgPoly.style.removeProperty("opacity");
      }
    };

    window.requestAnimationFrame(tick);
  }

  for (let i = 0; i < N; i++) {
    const t = angle(i);
    const lx = layout.center + (layout.radius + layout.labelPad) * Math.cos(t);
    const ly = layout.center + (layout.radius + layout.labelPad) * Math.sin(t);
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);

    let anchor = "middle";
    if (cosT > 0.3) {
      anchor = "start";
    } else if (cosT < -0.3) {
      anchor = "end";
    }

    let dy = "0.35em";
    if (sinT > 0.4) {
      dy = "0.85em";
    } else if (sinT < -0.4) {
      dy = "-0.1em";
    }

    const text = document.createElementNS(svgns, "text");
    text.setAttribute("x", lx.toFixed(2));
    text.setAttribute("y", ly.toFixed(2));
    text.setAttribute("text-anchor", anchor);
    text.setAttribute("dy", dy);
    text.setAttribute("class", "bon-radar-label");
    text.textContent = axes[i].label;
    svg.appendChild(text);
  }

  wrap.appendChild(svg);
  return wrap;
}
