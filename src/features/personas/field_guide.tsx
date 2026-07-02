// Field guide tab: editorial "history book" entries describing each persona.
// Each entry is a medallion with the body copy wrapping around it, a drop-cap
// opener, an identify list, and the known specimens (top exemplars). The book
// feel comes from layout — type stays within the page's sans/mono scopes since
// the serif is masthead-only.

import { Fragment, render } from "preact";
import type { Report } from "../../types.ts";
import { ARCHETYPES, type ArchetypeMeta } from "../../factors.ts";
import {
  FIELD_GUIDE_ENTRIES,
  type FieldGuideEntry,
} from "./field_guide_data.ts";
import {
  personasCollect,
  personasExemplars,
  type PersonaExemplar,
  type PersonasRow,
} from "./logic.ts";
import { PERSONA_MEDALLIONS } from "./medallions.ts";

export interface RenderFieldGuideOptions {
  onSelectUser: (username: string) => void;
}

export function renderFieldGuideTab(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null,
  options: RenderFieldGuideOptions
): void {
  if (!container) {
    return;
  }

  render(
    <FieldGuideTab reports={reports} onSelectUser={options.onSelectUser} />,
    container
  );
}

interface FieldGuideTabProps {
  reports: Array<Report & { username: string }>;
  onSelectUser: (username: string) => void;
}

function FieldGuideTab({ reports, onSelectUser }: FieldGuideTabProps) {
  const exemplars = personasExemplars(
    personasCollect(reports as PersonasRow[])
  );

  const entries = ARCHETYPES.map((archetype) => ({
    archetype,
    entry: FIELD_GUIDE_ENTRIES[archetype.key],
  })).filter(
    (pair): pair is { archetype: ArchetypeMeta; entry: FieldGuideEntry } =>
      pair.entry !== undefined
  );

  return (
    <section class="bon-personas-field-guide">
      <header class="bon-field-guide-masthead">
        <h2 class="bon-field-guide-page-title">Field guide</h2>
        <p class="bon-field-guide-lede">
          The kinds of accounts you'll meet on Reddit — what drives them, how to
          spot them, and who to read for the type.
        </p>
      </header>
      {entries.map(({ archetype, entry }) => (
        <GuideEntry
          key={archetype.key}
          archetype={archetype}
          entry={entry}
          exemplars={exemplars[archetype.key] ?? []}
          onSelectUser={onSelectUser}
        />
      ))}
    </section>
  );
}

interface GuideEntryProps {
  archetype: ArchetypeMeta;
  entry: FieldGuideEntry;
  exemplars: ReadonlyArray<PersonaExemplar>;
  onSelectUser: (username: string) => void;
}

function GuideEntry({
  archetype,
  entry,
  exemplars,
  onSelectUser,
}: GuideEntryProps) {
  return (
    <article
      class="bon-field-guide-entry"
      style={{ "--bon-archetype-hue": String(archetype.hue) }}
    >
      <h3 class="bon-field-guide-title">The {archetype.label}</h3>
      <p class="bon-field-guide-epigraph">{entry.epigraph}</p>
      {/* Floated before the body in source so the copy wraps around its
          right edge. */}
      <figure class="bon-field-guide-medallion">
        <img src={PERSONA_MEDALLIONS[archetype.key]} alt="" />
      </figure>
      <p class="bon-field-guide-body">{entry.body}</p>
      <h4 class="bon-field-guide-subhead">How to identify them</h4>
      <ul class="bon-field-guide-tells">
        {entry.tells.map((tell) => (
          <li key={tell}>{tell}</li>
        ))}
      </ul>
      <h4 class="bon-field-guide-subhead">Where they gather</h4>
      <p class="bon-field-guide-habitat">
        {entry.subreddits.map((subreddit, i) => (
          <Fragment key={subreddit}>
            {i > 0 && " · "}
            <span class="bon-field-guide-sub">r/{subreddit}</span>
          </Fragment>
        ))}
      </p>
      <h4 class="bon-field-guide-subhead">In their own words</h4>
      <div class="bon-field-guide-samples">
        {entry.samples.map((sample) => (
          <blockquote key={sample} class="bon-field-guide-sample">
            {sample}
          </blockquote>
        ))}
      </div>
      {exemplars.length > 0 && (
        <>
          <h4 class="bon-field-guide-subhead">Known specimens</h4>
          <p class="bon-field-guide-specimens">
            {exemplars.map((exemplar, i) => (
              <Fragment key={exemplar.username}>
                {i > 0 && " · "}
                <button
                  type="button"
                  class="bon-field-guide-specimen bon-pii-name"
                  title={`${Math.round(exemplar.score * 100)}% — open dossier`}
                  onClick={() => onSelectUser(exemplar.username)}
                >
                  u/{exemplar.username}
                </button>
              </Fragment>
            ))}
          </p>
        </>
      )}
    </article>
  );
}
