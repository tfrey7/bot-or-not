// Background-side dispatch for the subreddit-compromise feature.
//
// One-click analysis flow (subredditAnalyze):
//   1. Fetch up to SUBREDDIT_SAMPLE_SIZE post-authors from
//      /r/<sub>/new.json via subredditFetchAuthors. Background-only —
//      we don't depend on the operator having scrolled the feed, and a
//      Reddit 429 bubbles up the same way it does for any other Reddit
//      fetch.
//   2. Persist a SubredditReport recording which authors we sampled.
//   3. For each sampled author, reuse any existing "done" investigation
//      as-is — no freshness check, no re-run. We trust stored verdicts
//      across time (see memory: trust-stale-reports). For authors that
//      don't have a done report yet, enqueue a fresh investigation via
//      the existing per-user queue — the sub-level verdict materializes
//      as those drain.
//
// Read flow (subredditGetReport):
//   Returns the stored record alongside the live-derived verdict, so the
//   content-script badge can paint without needing two round trips.

import { readReports, readSubreddits, writeSubreddits } from "../../storage";
import type { SubredditReport } from "../../types.ts";
import { findReportKey } from "../../utils/history.ts";
import { investigationStartBatch } from "../investigation";
import { SUBREDDIT_SAMPLE_SIZE } from "./data.ts";
import { subredditFetchAuthors } from "./fetch_authors.ts";
import { subredditDeriveVerdict, type SubredditVerdict } from "./verdict.ts";

interface SubredditAnalyzeResult {
  ok: boolean;
  error?: string;
  record?: SubredditReport;
  enqueuedUsernames?: string[];
  reusedUsernames?: string[];
}

interface SubredditGetReportResult {
  ok: boolean;
  record: SubredditReport | null;
  verdict: SubredditVerdict | null;
}

export interface SubredditListEntry {
  record: SubredditReport;
  verdict: SubredditVerdict;
}

export interface SubredditListResult {
  ok: boolean;
  entries: SubredditListEntry[];
}

export async function subredditAnalyze(
  name: string
): Promise<SubredditAnalyzeResult> {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    return { ok: false, error: "missing-subreddit-name" };
  }

  let fetched: { authors: string[] };
  try {
    fetched = await subredditFetchAuthors(trimmedName, SUBREDDIT_SAMPLE_SIZE);
  } catch (error) {
    console.error(
      `[Bot or Not] subreddit-investigation: author fetch failed for r/${trimmedName}`,
      error
    );

    return { ok: false, error: "author-fetch-failed" };
  }

  const sampledUsernames = dedupedLowercase(fetched.authors);
  if (sampledUsernames.length === 0) {
    return { ok: false, error: "no-authors-found" };
  }

  const record: SubredditReport = {
    name: trimmedName,
    analyzedAt: Date.now(),
    sampledUsernames,
  };

  const nameKey = trimmedName.toLowerCase();
  const all = await readSubreddits();
  all[nameKey] = record;
  await writeSubreddits(all);

  // Reuse existing "done" investigations; only enqueue for the rest.
  const reports = await readReports();
  const enqueuedUsernames: string[] = [];
  const reusedUsernames: string[] = [];

  for (const username of sampledUsernames) {
    const key = findReportKey(reports, username);
    const investigation = key ? reports[key]?.investigation : null;

    if (investigation?.status === "done") {
      reusedUsernames.push(username);
      continue;
    }

    enqueuedUsernames.push(username);
  }

  // Single batched read-modify-write of the reports object. The per-user
  // alternative would emit ~3 storage ops × 100 users per analyze click,
  // which pegs the background SW and stalls the reports page until the
  // burst settles.
  await investigationStartBatch(enqueuedUsernames);

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
export async function subredditList(): Promise<SubredditListResult> {
  const [all, reports] = await Promise.all([readSubreddits(), readReports()]);

  const entries: SubredditListEntry[] = Object.values(all).map((record) => ({
    record,
    verdict: subredditDeriveVerdict(record, reports),
  }));

  entries.sort((a, b) => b.record.analyzedAt - a.record.analyzedAt);

  return { ok: true, entries };
}

export async function subredditGetReport(
  name: string
): Promise<SubredditGetReportResult> {
  const nameKey = (name || "").trim().toLowerCase();
  if (!nameKey) {
    return { ok: false, record: null, verdict: null };
  }

  const all = await readSubreddits();
  const record = all[nameKey] ?? null;

  if (!record) {
    return { ok: true, record: null, verdict: null };
  }

  const reports = await readReports();
  const verdict = subredditDeriveVerdict(record, reports);

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
