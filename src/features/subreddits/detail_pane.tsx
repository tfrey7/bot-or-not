// Per-subreddit detail pane — right column of the Subreddits split.
//
// One screen, no scrolling: title strip + verdict badge + sample-mix
// counts at the top, persona scatter (filtered to just this sub's
// sampled authors) below. The scatter reuses the Personas-tab component
// — same archetype anchors, same hover-card behavior, just with a
// smaller dot set. Clicking a dot opens the operator's user dossier.

import { personasCollect, PersonasScatter } from "../personas";
import { formatDate } from "../../utils/format_time.ts";
import type { Report } from "../../types.ts";
import type {
  SubredditListEntry,
  SubredditVerdict,
} from "../subreddit-investigation";
import {
  collectSampleRows,
  countSegments,
  describeDetailVerdict,
  personaCaption,
  progressLabel,
  SEGMENT_INFO,
  SEGMENT_ORDER,
} from "./logic.ts";

export interface SubredditsDetailProps {
  entry: SubredditListEntry | null;
  reportsByUsername: Map<string, Report>;
  hasAnyEntries: boolean;
  onSelectUser: (username: string) => void;
}

export function SubredditsDetail(props: SubredditsDetailProps) {
  const { entry, reportsByUsername, hasAnyEntries, onSelectUser } = props;

  if (!entry) {
    return <DetailEmpty hasAnyEntries={hasAnyEntries} />;
  }

  return (
    <>
      <DetailHeader entry={entry} />
      <div class="bon-detail-wrap bon-subreddits-detail-body">
        {!entry.verdict.ready && <DetailProgress verdict={entry.verdict} />}
        <MixStrip verdict={entry.verdict} />
        <DetailScatter
          entry={entry}
          reportsByUsername={reportsByUsername}
          onSelectUser={onSelectUser}
        />
      </div>
    </>
  );
}

function DetailEmpty({ hasAnyEntries }: { hasAnyEntries: boolean }) {
  return (
    <div class="bon-subreddits-detail-empty">
      <div class="bon-subreddits-detail-empty-icon">·</div>
      <p>
        {hasAnyEntries
          ? "Pick a subreddit on the left to see its persona spread."
          : "No subreddit analyses yet. Open one on Reddit and use the Bot or Not strip below the banner to start."}
      </p>
    </div>
  );
}

function DetailHeader({ entry }: { entry: SubredditListEntry }) {
  const { record, verdict } = entry;
  const descriptor = describeDetailVerdict(verdict);
  const analyzed = record.analyzedAt > 0 ? formatDate(record.analyzedAt) : "—";

  return (
    <header class="bon-detail-wrap bon-subreddits-detail-header">
      <div class="bon-subreddits-detail-title-row">
        <a
          class="bon-subreddits-detail-name"
          href={`https://www.reddit.com/r/${encodeURIComponent(record.name)}/`}
          target="_blank"
          rel="noopener noreferrer"
        >
          r/{record.name}
        </a>
        <span
          class={`bon-verdict-badge bon-verdict-badge--${descriptor.badgeModifier}`}
        >
          {descriptor.label}
        </span>
      </div>
      <p class="bon-subreddits-detail-meta">
        Sampled {record.sampledUsernames.length} authors · analyzed {analyzed}
      </p>
      <p class="bon-subreddits-detail-blurb">{descriptor.blurb}</p>
    </header>
  );
}

function DetailProgress({ verdict }: { verdict: SubredditVerdict }) {
  const settled = verdict.doneCount + verdict.errorCount;
  const percent =
    verdict.total > 0 ? Math.round((settled / verdict.total) * 100) : 0;

  return (
    <div
      class="bon-subreddits-detail-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={verdict.total}
      aria-valuenow={settled}
    >
      <p class="bon-subreddits-detail-progress-label">
        {progressLabel(verdict, percent)}
      </p>
      <div class="bon-subreddits-detail-progress-bar">
        <div
          class="bon-subreddits-detail-progress-fill"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}

function MixStrip({ verdict }: { verdict: SubredditVerdict }) {
  const counts = countSegments(verdict.samples);
  const present = SEGMENT_ORDER.filter((key) => counts[key] > 0);

  return (
    <div class="bon-subreddits-detail-mix">
      {present.length === 0 ? (
        <span class="bon-subreddits-detail-mix-empty">
          No samples returned yet.
        </span>
      ) : (
        present.map((key) => (
          <span
            key={key}
            class={`bon-verdict-badge bon-verdict-badge--${SEGMENT_INFO[key].badgeModifier}`}
          >
            {counts[key]} {SEGMENT_INFO[key].label}
          </span>
        ))
      )}
    </div>
  );
}

interface DetailScatterProps {
  entry: SubredditListEntry;
  reportsByUsername: Map<string, Report>;
  onSelectUser: (username: string) => void;
}

function DetailScatter({
  entry,
  reportsByUsername,
  onSelectUser,
}: DetailScatterProps) {
  const points = personasCollect(collectSampleRows(entry, reportsByUsername));

  if (points.length === 0) {
    return (
      <div class="bon-subreddits-detail-scatter">
        <div class="bon-subreddits-detail-scatter-empty">
          {entry.verdict.ready
            ? "No persona data — every sampled author errored or never returned a done verdict."
            : `Persona spread will appear once samples land (${entry.verdict.doneCount} of ${entry.verdict.total} done so far).`}
        </div>
      </div>
    );
  }

  return (
    <div class="bon-subreddits-detail-scatter">
      <PersonasScatter
        points={points}
        onSelect={onSelectUser}
        lookupReport={(username) =>
          reportsByUsername.get(username.toLowerCase()) ?? null
        }
      />
      <p class="bon-subreddits-detail-scatter-caption">
        {personaCaption(points, entry.verdict)}
      </p>
    </div>
  );
}
