// Background-side dispatch for the subreddit-compromise feature.
//
// One-click analysis flow (bonSubredditAnalyze):
//   1. Persist a SubredditReport recording which N authors we sampled.
//   2. For each sampled author, reuse any existing "done" investigation
//      as-is — no freshness check, no re-run. We trust stored verdicts
//      across time (see memory: trust-stale-reports). For authors that
//      don't have a done report yet, we enqueue a fresh investigation
//      via the existing per-user queue (concurrency capped at 2 — the
//      sub-level verdict materializes as those drain).
//
// Read flow (bonSubredditGetReport):
//   Returns the stored record alongside the live-derived verdict, so the
//   content-script badge can paint without needing two round trips.

import {
  bonReadReports,
  bonReadSubreddits,
  bonWriteSubreddits,
} from "../../storage.ts";
import type { SubredditReport } from "../../types.ts";
import { bonFindReportKey } from "../../utils/history.ts";
import { bonInvestigationStart } from "../investigation/handlers.ts";
import {
  bonSubredditDeriveVerdict,
  type BonSubredditVerdict,
} from "./verdict.ts";

export interface BonSubredditAnalyzeResult {
  ok: boolean;
  error?: string;
  record?: SubredditReport;
  enqueuedUsernames?: string[];
  reusedUsernames?: string[];
}

export interface BonSubredditGetReportResult {
  ok: boolean;
  record: SubredditReport | null;
  verdict: BonSubredditVerdict | null;
}

export interface BonSubredditListEntry {
  record: SubredditReport;
  verdict: BonSubredditVerdict;
}

export interface BonSubredditListResult {
  ok: boolean;
  entries: BonSubredditListEntry[];
}

export async function bonSubredditAnalyze(
  name: string,
  authors: string[]
): Promise<BonSubredditAnalyzeResult> {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    return { ok: false, error: "missing-subreddit-name" };
  }

  const sampledUsernames = dedupedLowercase(authors);
  if (sampledUsernames.length === 0) {
    return { ok: false, error: "no-authors-scraped" };
  }

  const record: SubredditReport = {
    name: trimmedName,
    analyzedAt: Date.now(),
    sampledUsernames,
  };

  const nameKey = trimmedName.toLowerCase();
  const all = await bonReadSubreddits();
  all[nameKey] = record;
  await bonWriteSubreddits(all);

  // Reuse existing "done" investigations; only enqueue for the rest.
  const reports = await bonReadReports();
  const enqueuedUsernames: string[] = [];
  const reusedUsernames: string[] = [];

  for (const username of sampledUsernames) {
    const key = bonFindReportKey(reports, username);
    const investigation = key ? reports[key]?.investigation : null;

    if (investigation?.status === "done") {
      reusedUsernames.push(username);
      continue;
    }

    // bonInvestigationStart is idempotent for queued/running already;
    // it also re-runs done records, which is why we gate above.
    await bonInvestigationStart(username);
    enqueuedUsernames.push(username);
  }

  return {
    ok: true,
    record,
    enqueuedUsernames,
    reusedUsernames,
  };
}

// List every stored subreddit investigation alongside its live-derived
// verdict, sorted most-recently-analyzed first. The Reports page's
// Subreddits tab consumes this — one round trip instead of fanning out a
// get-subreddit-report per entry.
export async function bonSubredditList(): Promise<BonSubredditListResult> {
  const [all, reports] = await Promise.all([
    bonReadSubreddits(),
    bonReadReports(),
  ]);

  const entries: BonSubredditListEntry[] = Object.values(all).map((record) => ({
    record,
    verdict: bonSubredditDeriveVerdict(record, reports),
  }));

  entries.sort((a, b) => b.record.analyzedAt - a.record.analyzedAt);

  return { ok: true, entries };
}

export async function bonSubredditGetReport(
  name: string
): Promise<BonSubredditGetReportResult> {
  const nameKey = (name || "").trim().toLowerCase();
  if (!nameKey) {
    return { ok: false, record: null, verdict: null };
  }

  const all = await bonReadSubreddits();
  const record = all[nameKey] ?? null;

  if (!record) {
    return { ok: true, record: null, verdict: null };
  }

  const reports = await bonReadReports();
  const verdict = bonSubredditDeriveVerdict(record, reports);

  return { ok: true, record, verdict };
}

function dedupedLowercase(usernames: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of usernames) {
    const trimmed = (raw || "").trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}
