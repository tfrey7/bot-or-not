// Personas tab entry point. Projects every investigated account's archetype
// vector into a 2D barycentric scatter so straddlers (superfan+shill etc.)
// land between their dominant anchors. Click a dot to jump to its dossier.

import { render } from "preact";
import type { Report } from "../../types.ts";
import { ArchetypeGrid } from "./archetype_grid.tsx";
import {
  personasCollect,
  personasExemplars,
  type PersonasRow,
} from "./logic.ts";
import { PersonasScatter } from "./scatter.tsx";

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

  render(
    <PersonasTab reports={reports} onSelectUser={options.onSelectUser} />,
    container
  );
}

interface PersonasTabProps {
  reports: Array<Report & { username: string }>;
  onSelectUser: (username: string) => void;
}

function PersonasTab({ reports, onSelectUser }: PersonasTabProps) {
  const points = personasCollect(reports as PersonasRow[]);
  const exemplars = personasExemplars(points);
  const ratedCount = points.filter((point) => point.isUserRated).length;

  // Lowercase-keyed lookup so the hover card can resolve a dot's report
  // synchronously — no background round-trip on every mouseenter.
  const reportsByUsername = new Map<string, Report>(
    reports.map((report) => [report.username.toLowerCase(), report])
  );

  const lookupReport = (username: string): Report | null =>
    reportsByUsername.get(username.toLowerCase()) ?? null;

  return (
    <section class="bon-personas">
      <header class="bon-personas-header">
        <h2>Persona space</h2>
        <p class="bon-personas-subtitle">
          {`Each investigated account projected onto the six persona axes (${reports.length} report${reports.length === 1 ? "" : "s"} total).`}
        </p>
      </header>
      {points.length === 0 ? (
        <div class="bon-personas-empty">
          No personas yet. Run an investigation on a reported user and they'll
          show up here once Claude scores their persona.
        </div>
      ) : (
        <>
          <Legend total={points.length} rated={ratedCount} />
          <div class="bon-personas-chart">
            <PersonasScatter
              points={points}
              onSelect={onSelectUser}
              lookupReport={lookupReport}
            />
          </div>
          <p class="bon-personas-footnote">
            Position = weighted sum of persona anchors · distance from center
            reads as how concentrated the persona is · click a dot to open the
            dossier.
          </p>
        </>
      )}
      <ArchetypeGrid exemplars={exemplars} onSelectUser={onSelectUser} />
    </section>
  );
}

function Legend({ total, rated }: { total: number; rated: number }) {
  return (
    <p class="bon-personas-legend">
      <span class="bon-personas-legend-swatch" />
      {` AI-investigated · ${total}    `}
      {rated > 0 && (
        <>
          <span class="bon-personas-legend-swatch bon-personas-legend-swatch--rated" />
          {` hand-rated reference · ${rated}`}
        </>
      )}
    </p>
  );
}

export { renderFieldGuideTab } from "./field_guide.tsx";
export { PersonasScatter } from "./scatter.tsx";
export { personasCollect } from "./logic.ts";
export type { PersonaPoint, PersonasRow } from "./logic.ts";
