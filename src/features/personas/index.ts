// Personas tab entry point. Projects every investigated account's archetype
// vector into a 2D barycentric scatter so straddlers (stan+hustler etc.)
// land between their dominant anchors. Click a dot to jump to its dossier.

import type { Report } from "../../types.ts";
import { personasArchetypeGrid } from "./archetype_grid.ts";
import {
  personasCollect,
  personasExemplars,
  type PersonasRow,
} from "./logic.ts";
import { personasScatter } from "./scatter.ts";

export interface RenderPersonasOptions {
  onSelectUser: (username: string) => void;
}

export function renderPersonasTab(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null,
  options: RenderPersonasOptions
): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "bon-personas";
  section.appendChild(buildHeader(reports));

  const points = personasCollect(reports as PersonasRow[]);
  const exemplars = personasExemplars(points);

  if (points.length === 0) {
    section.appendChild(buildEmptyState());
    section.appendChild(
      personasArchetypeGrid({
        exemplars,
        onSelectUser: options.onSelectUser,
      })
    );
    container.appendChild(section);
    return;
  }

  const ratedCount = points.filter((point) => point.isUserRated).length;
  section.appendChild(buildSubtitle(points.length, ratedCount));

  // Lowercase-keyed lookup so the hover card can resolve a dot's report
  // synchronously — no background round-trip on every mouseenter.
  const reportsByUsername = new Map<string, Report>();

  for (const report of reports) {
    reportsByUsername.set(report.username.toLowerCase(), report);
  }

  const lookupReport = (username: string): Report | null =>
    reportsByUsername.get(username.toLowerCase()) ?? null;

  const chart = document.createElement("div");
  chart.className = "bon-personas-chart";
  chart.appendChild(
    personasScatter(points, {
      onSelect: options.onSelectUser,
      lookupReport,
    })
  );
  section.appendChild(chart);

  section.appendChild(buildFootnote());
  section.appendChild(
    personasArchetypeGrid({
      exemplars,
      onSelectUser: options.onSelectUser,
    })
  );

  container.appendChild(section);
}

function buildHeader(
  reports: Array<Report & { username: string }>
): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-personas-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Persona space";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-personas-subtitle";
  sub.textContent = `Each investigated account projected onto the six persona axes (${reports.length} report${reports.length === 1 ? "" : "s"} total).`;
  header.appendChild(sub);

  return header;
}

function buildSubtitle(total: number, rated: number): HTMLElement {
  const para = document.createElement("p");
  para.className = "bon-personas-legend";

  const dotPlain = document.createElement("span");
  dotPlain.className = "bon-personas-legend-swatch";
  para.appendChild(dotPlain);
  para.appendChild(document.createTextNode(` AI-investigated · ${total}    `));

  if (rated > 0) {
    const dotRated = document.createElement("span");
    dotRated.className =
      "bon-personas-legend-swatch bon-personas-legend-swatch--rated";
    para.appendChild(dotRated);
    para.appendChild(
      document.createTextNode(` hand-rated reference · ${rated}`)
    );
  }

  return para;
}

function buildEmptyState(): HTMLElement {
  const div = document.createElement("div");
  div.className = "bon-personas-empty";
  div.textContent =
    "No personas yet. Run an investigation on a reported user and they'll show up here once Claude scores their persona.";

  return div;
}

function buildFootnote(): HTMLElement {
  const para = document.createElement("p");
  para.className = "bon-personas-footnote";
  para.textContent =
    "Position = weighted sum of persona anchors · distance from center reads as how concentrated the persona is · click a dot to open the dossier.";

  return para;
}

export { personasScatter } from "./scatter.ts";
export type { PersonasScatterOptions } from "./scatter.ts";
export { personasCollect } from "./logic.ts";
export type { PersonaPoint, PersonasRow } from "./logic.ts";
