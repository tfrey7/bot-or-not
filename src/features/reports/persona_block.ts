// Persona aside in the expanded investigation detail: radar chart of
// archetype strengths + dominant label + the LLM's one-line reasoning.
// Returns null if the investigation has no persona data. Legacy
// investigations stored before the radar (no `archetypes`) still render —
// just the label + reasoning, no chart.

import { BON_ARCHETYPES } from "../../factors.ts";
import type { ArchetypeKey, Persona } from "../../types.ts";

function renderPersonaRadar(
  archetypes: Record<ArchetypeKey, number>
): HTMLDivElement | null {
  const svgns = "http://www.w3.org/2000/svg";

  // Vertices are laid out starting at top (12 o'clock) and going clockwise,
  // one per BON_ARCHETYPES entry — chart grows if a new archetype is added.
  const v = {
    size: 220,
    center: 110,
    radius: 76,
    labelPad: 14,
    gridLevels: 4,
  };

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
  wrap.className = "bon-persona-radar";
  wrap.title = axes
    .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
    .join("  ·  ");

  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", `0 0 ${v.size} ${v.size}`);
  svg.setAttribute("class", "bon-radar");
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
        ? "bon-radar-grid bon-radar-grid--outer"
        : "bon-radar-grid"
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
    line.setAttribute("class", "bon-radar-axis");
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
  dataPoly.setAttribute("class", "bon-radar-data");
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
    dot.setAttribute("class", "bon-radar-dot");
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
    text.setAttribute("class", "bon-radar-label");
    text.textContent = axes[i].label;
    svg.appendChild(text);
  }

  wrap.appendChild(svg);
  return wrap;
}

export function bonReportsPersonaBlock(
  persona: Persona | null | undefined
): HTMLElement | null {
  if (!persona || !persona.label) {
    return null;
  }

  const block = document.createElement("aside");
  block.className = `bon-persona bon-persona--${persona.label}`;

  const heading = document.createElement("p");
  heading.className = "bon-persona-heading";
  heading.textContent = "Persona profile";
  block.appendChild(heading);

  if (persona.archetypes) {
    const radar = renderPersonaRadar(persona.archetypes);
    if (radar) {
      block.appendChild(radar);
    }
  }

  const labelText =
    persona.label === "normal"
      ? "Normal"
      : BON_ARCHETYPES.find((a) => a.key === persona.label)?.label ||
        persona.label;

  const label = document.createElement("p");
  label.className = `bon-persona-label bon-persona-label--${persona.label}`;
  label.textContent = labelText;
  block.appendChild(label);

  if (persona.reasoning) {
    const blurb = document.createElement("p");
    blurb.className = "bon-persona-blurb";
    blurb.textContent = persona.reasoning;
    block.appendChild(blurb);
  }
  return block;
}
