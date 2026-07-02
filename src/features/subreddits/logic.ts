// Pure transforms behind the Subreddits tab — verdict descriptors, sample
// segment counting, progress/caption copy. No DOM, no I/O.

import type { PersonaPoint, PersonasRow } from "../personas";
import type { Report, Verdict } from "../../types.ts";
import type {
  SubredditListEntry,
  SubredditSample,
  SubredditVerdict,
} from "../subreddit-investigation";

export type SegmentKey =
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

export const SEGMENT_ORDER: SegmentKey[] = [
  "bot",
  "likely-bot",
  "uncertain",
  "likely-human",
  "human",
  "error",
  "pending",
];

export const SEGMENT_INFO: Record<SegmentKey, SegmentDescriptor> = {
  bot: { label: "bot", badgeModifier: "bot" },
  "likely-bot": { label: "likely bot", badgeModifier: "likely-bot" },
  uncertain: { label: "uncertain", badgeModifier: "uncertain" },
  "likely-human": { label: "likely human", badgeModifier: "likely-human" },
  human: { label: "human", badgeModifier: "human" },
  error: { label: "errored", badgeModifier: "error" },
  pending: { label: "pending", badgeModifier: "queued" },
};

export interface VerdictDescriptor {
  badgeModifier: string;
  label: string;
}

export interface DetailVerdictDescriptor extends VerdictDescriptor {
  blurb: string;
}

export function nameKeyOf(entry: SubredditListEntry): string {
  return entry.record.name.toLowerCase();
}

export function describeListVerdict(
  verdict: SubredditVerdict
): VerdictDescriptor {
  if (!verdict.ready) {
    return { badgeModifier: "queued", label: "Pending" };
  }

  if (verdict.inconclusive) {
    return { badgeModifier: "uncertain", label: "Inconclusive" };
  }

  if (verdict.compromised) {
    return { badgeModifier: "bot", label: "Compromised" };
  }

  return { badgeModifier: "human", label: "Healthy" };
}

export function describeDetailVerdict(
  verdict: SubredditVerdict
): DetailVerdictDescriptor {
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

export function progressLabel(
  verdict: SubredditVerdict,
  percent: number
): string {
  const parts: string[] = [`${verdict.doneCount} complete`];

  if (verdict.errorCount > 0) {
    parts.push(`${verdict.errorCount} errored`);
  }

  parts.push(`${verdict.pendingCount} in flight`);

  return `Analyzing ${verdict.total} authors · ${percent}% · ${parts.join(" · ")}`;
}

export function personaCaption(
  points: PersonaPoint[],
  verdict: SubredditVerdict
): string {
  const plotted = points.length;
  const missing = verdict.total - plotted;
  if (missing <= 0) {
    return `${plotted} authors plotted — click a dot for the dossier.`;
  }

  return `${plotted} authors plotted · ${missing} pending or errored · click a dot for the dossier.`;
}

// Resolve the sample list to live Report records so the scatter sees each
// author's persona vector. Authors without a done investigation (queued,
// errored, never started) are silently absent — the mix strip already
// accounts for them.
export function collectSampleRows(
  entry: SubredditListEntry,
  reportsByUsername: Map<string, Report>
): PersonasRow[] {
  const rows: PersonasRow[] = [];

  for (const username of entry.record.sampledUsernames) {
    const report = reportsByUsername.get(username.toLowerCase());
    if (!report) {
      continue;
    }

    rows.push({ ...report, username });
  }

  return rows;
}

export function countSegments(
  samples: SubredditSample[]
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
