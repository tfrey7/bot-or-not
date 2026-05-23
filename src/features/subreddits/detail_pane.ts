// Per-subreddit detail pane — right column of the Subreddits split.
//
// One screen, no scrolling: title strip + verdict badge + sample-mix
// counts at the top, persona scatter (filtered to just this sub's
// sampled authors) below. The scatter reuses the Personas-tab renderer
// — same archetype anchors, same hover-card behavior, just with a
// smaller dot set. Clicking a dot opens the operator's user dossier.
//
// Layout sizing assumes a stacked sub-screen below the sticky tabs;
// CSS gives the scatter a flex floor so it stays comfortably within
// the viewport on a 768px-tall laptop screen.

import { bonPersonasScatter } from "../personas/scatter.ts";
import {
  bonPersonasCollect,
  type PersonaPoint,
  type PersonasRow,
} from "../personas/logic.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import type { Report, Verdict } from "../../types.ts";
import type { BonSubredditListEntry } from "../subreddit-investigation/handlers.ts";
import type {
  BonSubredditSample,
  BonSubredditVerdict,
} from "../subreddit-investigation/verdict.ts";

export interface BonSubredditsDetailOptions {
  entry: BonSubredditListEntry | null;
  reportsByUsername: Map<string, Report>;
  hasAnyEntries: boolean;
  onSelectUser: (username: string) => void;
}

type SegmentKey =
  | "bot"
  | "likely-bot"
  | "uncertain"
  | "likely-human"
  | "human"
  | "error"
  | "pending";

interface SegmentDescriptor {
  label: string;
  badgeModifier: string;
}

const BON_SEGMENT_ORDER: SegmentKey[] = [
  "bot",
  "likely-bot",
  "uncertain",
  "likely-human",
  "human",
  "error",
  "pending",
];

const BON_SEGMENT_INFO: Record<SegmentKey, SegmentDescriptor> = {
  bot: { label: "bot", badgeModifier: "bot" },
  "likely-bot": { label: "likely bot", badgeModifier: "likely-bot" },
  uncertain: { label: "uncertain", badgeModifier: "uncertain" },
  "likely-human": { label: "likely human", badgeModifier: "likely-human" },
  human: { label: "human", badgeModifier: "human" },
  error: { label: "errored", badgeModifier: "error" },
  pending: { label: "pending", badgeModifier: "queued" },
};

interface VerdictDescriptor {
  badgeModifier: string;
  label: string;
  blurb: string;
}

export function bonRenderSubredditsDetail(
  options: BonSubredditsDetailOptions
): HTMLElement {
  const { entry, hasAnyEntries } = options;

  if (!entry) {
    return buildEmpty(hasAnyEntries);
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-subreddits-detail";

  wrap.appendChild(buildHeader(entry));
  wrap.appendChild(buildMixStrip(entry.verdict));
  wrap.appendChild(buildScatter(entry, options));

  return wrap;
}

function buildEmpty(hasAnyEntries: boolean): HTMLElement {
  const div = document.createElement("div");
  div.className = "bon-subreddits-detail-empty";

  const icon = document.createElement("div");
  icon.className = "bon-subreddits-detail-empty-icon";
  icon.textContent = "·";
  div.appendChild(icon);

  const text = document.createElement("p");
  text.textContent = hasAnyEntries
    ? "Pick a subreddit on the left to see its persona spread."
    : "No subreddit analyses yet. Open one on Reddit and use the Bot or Not strip below the banner to start.";
  div.appendChild(text);

  return div;
}

function buildHeader(entry: BonSubredditListEntry): HTMLElement {
  const { record, verdict } = entry;
  const descriptor = describeVerdict(verdict);

  const header = document.createElement("header");
  header.className = "bon-subreddits-detail-header";

  const title = document.createElement("div");
  title.className = "bon-subreddits-detail-title";

  const link = document.createElement("a");
  link.className = "bon-subreddits-detail-name";
  link.href = `https://www.reddit.com/r/${encodeURIComponent(record.name)}/`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `r/${record.name}`;
  title.appendChild(link);

  const badge = document.createElement("span");
  badge.className = `bon-verdict-badge bon-verdict-badge--${descriptor.badgeModifier} bon-subreddits-detail-badge`;
  badge.textContent = descriptor.label;
  title.appendChild(badge);

  header.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "bon-subreddits-detail-meta";
  const analyzed =
    record.analyzedAt > 0 ? bonFormatDate(record.analyzedAt) : "—";
  meta.textContent = `Sampled ${record.sampledUsernames.length} authors · analyzed ${analyzed}`;
  header.appendChild(meta);

  const blurb = document.createElement("p");
  blurb.className = "bon-subreddits-detail-blurb";
  blurb.textContent = descriptor.blurb;
  header.appendChild(blurb);

  return header;
}

function buildMixStrip(verdict: BonSubredditVerdict): HTMLElement {
  const counts = countSegments(verdict.samples);

  const strip = document.createElement("div");
  strip.className = "bon-subreddits-detail-mix";

  for (const key of BON_SEGMENT_ORDER) {
    const count = counts[key];
    if (count === 0) {
      continue;
    }

    const info = BON_SEGMENT_INFO[key];
    const badge = document.createElement("span");
    badge.className = `bon-verdict-badge bon-verdict-badge--${info.badgeModifier}`;
    badge.textContent = `${count} ${info.label}`;
    strip.appendChild(badge);
  }

  if (strip.childElementCount === 0) {
    const empty = document.createElement("span");
    empty.className = "bon-subreddits-detail-mix-empty";
    empty.textContent = "No samples returned yet.";
    strip.appendChild(empty);
  }

  return strip;
}

function buildScatter(
  entry: BonSubredditListEntry,
  options: BonSubredditsDetailOptions
): HTMLElement {
  const { reportsByUsername, onSelectUser } = options;

  // Resolve the sample list to live Report records so the scatter sees
  // each author's persona vector and the hover card can synthesize a
  // tooltip in-place. Authors without a done investigation (queued,
  // errored, never started) are silently absent — the mix strip above
  // already accounts for them.
  const sampleReports: PersonasRow[] = [];

  for (const username of entry.record.sampledUsernames) {
    const report = reportsByUsername.get(username.toLowerCase());
    if (!report) {
      continue;
    }

    sampleReports.push({ ...report, username });
  }

  const points = bonPersonasCollect(sampleReports);

  const wrap = document.createElement("div");
  wrap.className = "bon-subreddits-detail-scatter";

  if (points.length === 0) {
    const empty = document.createElement("div");
    empty.className = "bon-subreddits-detail-scatter-empty";
    empty.textContent = entry.verdict.ready
      ? "No persona data — every sampled author errored or never returned a done verdict."
      : `Persona spread will appear once samples land (${entry.verdict.doneCount} of ${entry.verdict.total} done so far).`;
    wrap.appendChild(empty);
    return wrap;
  }

  wrap.appendChild(
    bonPersonasScatter(points, {
      onSelect: onSelectUser,
      lookupReport: (username) =>
        reportsByUsername.get(username.toLowerCase()) ?? null,
    })
  );

  const caption = document.createElement("p");
  caption.className = "bon-subreddits-detail-scatter-caption";
  caption.textContent = personaCaption(points, entry.verdict);
  wrap.appendChild(caption);

  return wrap;
}

function personaCaption(
  points: PersonaPoint[],
  verdict: BonSubredditVerdict
): string {
  const plotted = points.length;
  const missing = verdict.total - plotted;
  if (missing <= 0) {
    return `${plotted} authors plotted — click a dot for the dossier.`;
  }

  return `${plotted} authors plotted · ${missing} pending or errored · click a dot for the dossier.`;
}

function countSegments(
  samples: BonSubredditSample[]
): Record<SegmentKey, number> {
  const counts: Record<SegmentKey, number> = {
    bot: 0,
    "likely-bot": 0,
    uncertain: 0,
    "likely-human": 0,
    human: 0,
    error: 0,
    pending: 0,
  };

  for (const sample of samples) {
    if (sample.status === "done" && sample.verdict) {
      counts[verdictBucket(sample.verdict)] += 1;
      continue;
    }

    if (sample.status === "error") {
      counts.error += 1;
      continue;
    }

    counts.pending += 1;
  }

  return counts;
}

function verdictBucket(verdict: Verdict): SegmentKey {
  if (verdict === "bot") {
    return "bot";
  }

  if (verdict === "likely-bot") {
    return "likely-bot";
  }

  if (verdict === "likely-human") {
    return "likely-human";
  }

  if (verdict === "human") {
    return "human";
  }

  return "uncertain";
}

function describeVerdict(verdict: BonSubredditVerdict): VerdictDescriptor {
  if (!verdict.ready) {
    return {
      badgeModifier: "queued",
      label: "Pending",
      blurb: `${verdict.doneCount} of ${verdict.total} samples completed so far.`,
    };
  }

  if (verdict.inconclusive) {
    return {
      badgeModifier: "uncertain",
      label: "Inconclusive",
      blurb:
        "No sampled author has a usable verdict — every investigation errored or never landed.",
    };
  }

  if (verdict.compromised) {
    return {
      badgeModifier: "bot",
      label: "Compromised",
      blurb: `${verdict.botLeaningCount} of ${verdict.doneCount} sampled authors flagged as bot-leaning (≥50%).`,
    };
  }

  return {
    badgeModifier: "human",
    label: "Healthy",
    blurb: `${verdict.botLeaningCount} of ${verdict.doneCount} sampled authors flagged as bot-leaning (under the 50% threshold).`,
  };
}
