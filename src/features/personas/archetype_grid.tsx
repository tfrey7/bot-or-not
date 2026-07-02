// "About the archetypes" grid shown below the persona-space scatter. Six
// cards — one per radar axis — each with a mini hexagon echoing the chart
// above: the medallion artwork clipped to the same hexagonal silhouette as
// the profile-radar widget, with the card's archetype vertex highlighted in
// its hue. Order matches ARCHETYPES so the grid reads in the same
// sequence as the chart's spokes (clockwise from the top).

import { Fragment } from "preact";
import { useId } from "preact/hooks";
import type { ArchetypeKey } from "../../types.ts";
import { ARCHETYPES, type ArchetypeMeta } from "../../factors.ts";
import type { PersonaExemplar, PersonaExemplars } from "./logic.ts";
import { PERSONA_MEDALLIONS } from "./medallions.ts";

// Geometry mirrors personaRadar's RADAR_LAYOUT proportions
// (radius/center ≈ 0.69) so the card hex visually echoes the profile radar
// at a smaller scale. iconScale=1.3 matches the radar too — pulls the
// medallion past the polygon's flat edges so the corner vertices land
// inside image bounds and don't clip to background.
const HEX_VIEWBOX = 100;
const HEX_CENTER = HEX_VIEWBOX / 2;
const HEX_RADIUS = 34;
const HEX_ICON_SCALE = 1.3;

const HEX_VERTICES = ARCHETYPES.map((archetype, i) => {
  const step = (Math.PI * 2) / ARCHETYPES.length;
  const theta = -Math.PI / 2 + i * step;
  return {
    key: archetype.key,
    hue: archetype.hue,
    x: HEX_CENTER + Math.cos(theta) * HEX_RADIUS,
    y: HEX_CENTER + Math.sin(theta) * HEX_RADIUS,
  };
});

export interface ArchetypeGridProps {
  exemplars: PersonaExemplars;
  onSelectUser: (username: string) => void;
}

export function ArchetypeGrid({ exemplars, onSelectUser }: ArchetypeGridProps) {
  return (
    <section class="bon-personas-archetypes">
      <h3 class="bon-personas-archetypes-heading">About the personas</h3>
      <ul class="bon-personas-archetypes-grid">
        {ARCHETYPES.map((archetype) => (
          <ArchetypeCard
            key={archetype.key}
            archetype={archetype}
            exemplars={exemplars[archetype.key] ?? []}
            onSelectUser={onSelectUser}
          />
        ))}
      </ul>
    </section>
  );
}

interface ArchetypeCardProps {
  archetype: ArchetypeMeta;
  exemplars: ReadonlyArray<PersonaExemplar>;
  onSelectUser: (username: string) => void;
}

function ArchetypeCard({
  archetype,
  exemplars,
  onSelectUser,
}: ArchetypeCardProps) {
  return (
    <li
      class="bon-personas-archetype-card"
      style={{ "--bon-archetype-hue": String(archetype.hue) }}
    >
      <MiniHexagon highlight={archetype.key} />
      <div class="bon-personas-archetype-text">
        <p class="bon-personas-archetype-label">{archetype.label}</p>
        <p class="bon-personas-archetype-blurb">{archetype.blurb}</p>
        {exemplars.length > 0 && (
          <p class="bon-personas-archetype-exemplars">
            <span class="bon-personas-archetype-exemplars-heading">
              Strongest examples:
            </span>
            {exemplars.map((exemplar, i) => (
              <Fragment key={exemplar.username}>
                {i > 0 && " · "}
                <button
                  type="button"
                  class="bon-personas-archetype-exemplar bon-pii-name"
                  title={`${Math.round(exemplar.score * 100)}% — open dossier`}
                  onClick={() => onSelectUser(exemplar.username)}
                >
                  u/{exemplar.username}
                </button>
              </Fragment>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

// Mini hexagon: medallion image rendered as a <pattern> fill on a <polygon>
// whose geometry IS the clip — same technique as personaRadar's
// .bon-radar-bg, just without the radar's grid/data/animation layers. The
// vertex matching `highlight` is enlarged and filled in its archetype hue.
function MiniHexagon({ highlight }: { highlight: ArchetypeKey }) {
  const patternId = `bon-persona-hex-pat-${highlight}-${useId()}`;

  const iconRadius = HEX_RADIUS * HEX_ICON_SCALE;
  const iconSize = iconRadius * 2;
  const iconOffset = HEX_CENTER - iconRadius;
  const points = HEX_VERTICES.map((vertex) => `${vertex.x},${vertex.y}`).join(
    " "
  );

  return (
    <svg
      viewBox={`0 0 ${HEX_VIEWBOX} ${HEX_VIEWBOX}`}
      class="bon-personas-archetype-hex"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          x={iconOffset}
          y={iconOffset}
          width={iconSize}
          height={iconSize}
        >
          <image
            href={PERSONA_MEDALLIONS[highlight]}
            x={0}
            y={0}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid meet"
          />
        </pattern>
      </defs>
      <polygon
        points={points}
        fill={`url(#${patternId})`}
        class="bon-personas-archetype-hex-fill"
      />
      <polygon points={points} class="bon-personas-archetype-hex-outline" />
      {HEX_VERTICES.map((vertex) =>
        vertex.key === highlight ? (
          <circle
            key={vertex.key}
            cx={vertex.x}
            cy={vertex.y}
            r={5.5}
            class="bon-personas-archetype-hex-dot--active"
            fill={`hsl(${vertex.hue} 65% 52%)`}
          />
        ) : (
          <circle
            key={vertex.key}
            cx={vertex.x}
            cy={vertex.y}
            r={2.5}
            class="bon-personas-archetype-hex-dot"
          />
        )
      )}
    </svg>
  );
}
