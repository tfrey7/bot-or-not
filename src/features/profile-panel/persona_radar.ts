// The persona "card" rendered to the right of the preview summary — a
// labeled radar chart of the seven human-flavor archetype strengths (Stan,
// Farmer, Teen, Thirst, Crank, Hustler, Doomer) plus the picked label and
// reasoning blurb. Wraps a small SVG radar plotter; one polygon per grid
// ring, one polygon for the data, dots on each non-trivial axis.

import { BON_ARCHETYPES } from "../../factors.ts";
import type { ArchetypeKey, Persona } from "../../types.ts";

const RADAR_VIEW = {
  size: 220,
  center: 110,
  radius: 76,
  labelPad: 14,
  gridLevels: 4,
};

function buildPersonaRadar(
  archetypes: Record<ArchetypeKey, number>
): HTMLDivElement | null {
  const svgns = "http://www.w3.org/2000/svg";
  const v = RADAR_VIEW;
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
      x: v.center + v.radius * scale * Math.cos(t),
      y: v.center + v.radius * scale * Math.sin(t),
    };
  };

  const points = (scale: number): string =>
    axes
      .map((_, i) => {
        const p = vertex(i, scale);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      })
      .join(" ");

  const wrap = document.createElement("div");
  wrap.className = "bon-panel-persona-radar";
  wrap.title = axes
    .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
    .join("  ·  ");

  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", `0 0 ${v.size} ${v.size}`);
  svg.setAttribute("class", "bon-panel-radar");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Persona radar: ${axes
      .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
      .join(", ")}`
  );

  for (let g = 1; g <= v.gridLevels; g++) {
    const poly = document.createElementNS(svgns, "polygon");
    poly.setAttribute("points", points(g / v.gridLevels));
    poly.setAttribute(
      "class",
      g === v.gridLevels
        ? "bon-panel-radar-grid bon-panel-radar-grid--outer"
        : "bon-panel-radar-grid"
    );
    svg.appendChild(poly);
  }

  for (let i = 0; i < N; i++) {
    const p = vertex(i, 1);

    const line = document.createElementNS(svgns, "line");
    line.setAttribute("x1", String(v.center));
    line.setAttribute("y1", String(v.center));
    line.setAttribute("x2", p.x.toFixed(2));
    line.setAttribute("y2", p.y.toFixed(2));
    line.setAttribute("class", "bon-panel-radar-axis");
    svg.appendChild(line);
  }

  const dataPolyPts = axes
    .map((a, i) => {
      const score = Math.max(0, Math.min(1, archetypes[a.key] || 0));
      const p = vertex(i, score);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");

  const dataPoly = document.createElementNS(svgns, "polygon");
  dataPoly.setAttribute("points", dataPolyPts);
  dataPoly.setAttribute("class", "bon-panel-radar-data");
  svg.appendChild(dataPoly);

  for (let i = 0; i < N; i++) {
    const score = archetypes[axes[i].key] || 0;
    if (score <= 0.05) {
      continue;
    }

    const p = vertex(i, score);

    const dot = document.createElementNS(svgns, "circle");
    dot.setAttribute("cx", p.x.toFixed(2));
    dot.setAttribute("cy", p.y.toFixed(2));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "bon-panel-radar-dot");
    svg.appendChild(dot);
  }

  for (let i = 0; i < N; i++) {
    const t = angle(i);
    const lx = v.center + (v.radius + v.labelPad) * Math.cos(t);
    const ly = v.center + (v.radius + v.labelPad) * Math.sin(t);
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
    text.setAttribute("class", "bon-panel-radar-label");
    text.textContent = axes[i].label;
    svg.appendChild(text);
  }

  wrap.appendChild(svg);
  return wrap;
}

export function bonPanelBuildPersonaStrip(persona: Persona): HTMLElement {
  const wrap = document.createElement("aside");
  wrap.className = `bon-panel-persona bon-panel-persona--${persona.label}`;

  const tag = document.createElement("p");
  tag.className = "bon-panel-persona__tag";
  tag.textContent = "Persona profile";
  wrap.appendChild(tag);

  if (persona.archetypes) {
    const radar = buildPersonaRadar(persona.archetypes);
    if (radar) {
      wrap.appendChild(radar);
    }
  }

  const label = document.createElement("p");
  label.className = "bon-panel-persona__label";

  const labelText =
    persona.label === "normal"
      ? "Normal"
      : BON_ARCHETYPES.find((a) => a.key === persona.label)?.label ||
        persona.label;

  label.textContent = labelText;
  wrap.appendChild(label);

  if (persona.reasoning) {
    const blurb = document.createElement("p");
    blurb.className = "bon-panel-persona__blurb";
    blurb.textContent = persona.reasoning;
    wrap.appendChild(blurb);
  }

  return wrap;
}
