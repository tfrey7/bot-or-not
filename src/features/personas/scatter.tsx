// Personas scatter plot: archetype anchors around a hexagon, each
// investigated account placed at the barycentric projection of its
// archetype radar vector. Data comes pre-computed from logic.ts.

import type { Report } from "../../types.ts";
import { ARCHETYPES } from "../../factors.ts";
import { personasHideHover, personasShowHover } from "./hover_card.ts";
import {
  PERSONAS_ANCHORS,
  type ArchetypeAnchor,
  type PersonaPoint,
} from "./logic.ts";

// Plot radius and label pad are in SVG units; viewBox is sized so the
// widest labels (SHILL on the left, FARMER on the right) clear the disk
// without clipping. CENTER stays at viewBox/2 so the plot remains centered.
const VIEWBOX = 680;
const CENTER = VIEWBOX / 2;
const PLOT_RADIUS = 220;
const LABEL_PAD = 38;

export interface PersonasScatterProps {
  points: PersonaPoint[];
  onSelect: (username: string) => void;
  lookupReport: (username: string) => Report | null;
}

export function PersonasScatter({
  points,
  onSelect,
  lookupReport,
}: PersonasScatterProps) {
  // Sort weakest-first so concentrated personas render on top — visually,
  // the strong opinions sit above the centroid haze instead of underneath.
  const sorted = [...points].sort((a, b) => a.magnitude - b.magnitude);

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      class="bon-personas-scatter"
      role="img"
      aria-label={`Persona space: ${points.length} accounts plotted across ${ARCHETYPES.length} persona axes`}
    >
      <Backdrop />
      <Axes />
      {sorted.map((point) => (
        <Dot
          key={point.username}
          point={point}
          onSelect={onSelect}
          lookupReport={lookupReport}
        />
      ))}
      {PERSONAS_ANCHORS.map((anchor) => (
        <AnchorLabel key={anchor.key} anchor={anchor} />
      ))}
    </svg>
  );
}

// Rings are hexagonal polygons whose corners land on the archetype spokes,
// echoing the persona hexagon used elsewhere. Vertex count tracks the
// archetype count automatically via PERSONAS_ANCHORS.
function ringPoints(radius: number): string {
  return PERSONAS_ANCHORS.map(
    (anchor) => `${CENTER + anchor.x * radius},${CENTER + anchor.y * radius}`
  ).join(" ");
}

function Backdrop() {
  const rings = 4;

  return (
    <g class="bon-personas-backdrop">
      {Array.from({ length: rings }, (_, i) => i + 1).map((ring) => (
        <polygon
          key={ring}
          points={ringPoints((PLOT_RADIUS * ring) / rings)}
          class={
            ring === rings
              ? "bon-personas-ring bon-personas-ring--outer"
              : "bon-personas-ring"
          }
        />
      ))}
    </g>
  );
}

function Axes() {
  return (
    <g class="bon-personas-axes">
      {PERSONAS_ANCHORS.map((anchor) => (
        <line
          key={anchor.key}
          x1={CENTER}
          y1={CENTER}
          x2={CENTER + anchor.x * PLOT_RADIUS}
          y2={CENTER + anchor.y * PLOT_RADIUS}
          class="bon-personas-axis"
        />
      ))}
    </g>
  );
}

function AnchorLabel({ anchor }: { anchor: ArchetypeAnchor }) {
  const lx = CENTER + anchor.x * (PLOT_RADIUS + LABEL_PAD);
  const ly = CENTER + anchor.y * (PLOT_RADIUS + LABEL_PAD);

  // Anchor labels right of the disk are left-aligned, labels left of it are
  // right-aligned, anything near top/bottom centers — keeps text from
  // overlapping the rings on either side.
  const anchorPos =
    anchor.x > 0.3 ? "start" : anchor.x < -0.3 ? "end" : "middle";

  // Same trick vertically so labels above/below sit above/below the peg
  // instead of crashing into it.
  const dy = anchor.y > 0.4 ? "0.85em" : anchor.y < -0.4 ? "-0.2em" : "0.35em";

  return (
    <g class="bon-personas-anchor">
      <circle
        cx={CENTER + anchor.x * PLOT_RADIUS}
        cy={CENTER + anchor.y * PLOT_RADIUS}
        r={4}
        class="bon-personas-peg"
        fill={`hsl(${anchor.hue} 55% 45%)`}
      />
      <text
        x={lx}
        y={ly}
        class="bon-personas-anchor-label"
        fill={`hsl(${anchor.hue} 55% 38%)`}
        text-anchor={anchorPos}
        dy={dy}
      >
        {anchor.label}
      </text>
    </g>
  );
}

interface DotProps {
  point: PersonaPoint;
  onSelect: (username: string) => void;
  lookupReport: (username: string) => Report | null;
}

function Dot({ point, onSelect, lookupReport }: DotProps) {
  const cx = CENTER + point.x * PLOT_RADIUS;
  const cy = CENTER + point.y * PLOT_RADIUS;

  // Radius scales with magnitude — a strongly mono-archetype account reads
  // larger than a centroid haze account. Floor keeps weak signals visible.
  const r = 4 + point.magnitude * 4;

  const fill =
    point.hue !== null ? `hsl(${point.hue} 65% 52%)` : "var(--bon-muted)";

  const openHover = (event: { currentTarget: SVGGElement }): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    personasShowHover(point.username, lookupReport(point.username), rect);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(point.username);
    }
  };

  return (
    <g
      class={
        point.isUserRated
          ? "bon-personas-dot bon-personas-dot--rated"
          : "bon-personas-dot"
      }
      data-bon-username={point.username}
      tabIndex={0}
      role="button"
      aria-label={`${point.username} — ${formatTooltip(point)}`}
      onClick={() => onSelect(point.username)}
      onKeyDown={handleKeyDown}
      onMouseEnter={openHover}
      onMouseLeave={personasHideHover}
      onFocus={openHover}
      onBlur={personasHideHover}
    >
      {point.isUserRated && (
        <circle cx={cx} cy={cy} r={r + 3} class="bon-personas-dot-halo" />
      )}
      <circle cx={cx} cy={cy} r={r} class="bon-personas-dot-fill" fill={fill} />
      {/* Native tooltip is the keyboard-friendly fallback / a11y surface;
          the hover card layered above does the rich preview when a pointer
          is in play. */}
      <title>{formatTooltip(point)}</title>
    </g>
  );
}

function formatTooltip(point: PersonaPoint): string {
  const label =
    ARCHETYPES.find((archetype) => archetype.key === point.topArchetype)
      ?.label ?? point.topArchetype;
  const pct = Math.round(point.topScore * 100);
  const ratedSuffix = point.isUserRated ? " · hand-rated" : "";
  return `u/${point.username} · ${label} ${pct}%${ratedSuffix}`;
}
