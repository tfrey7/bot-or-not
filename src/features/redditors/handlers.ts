// Background-context handlers for the reports store. The dispatcher in
// background.ts unpacks each message and calls the matching function here.
// Reports records own the reported-account state — count, history, ring
// membership, last-seen statuses — so every read/write of those fields
// lives in this file.

import { BON_PERSONA_LABELS } from "../../factors.ts";
import type { PersonaLabel, Report, UserNotes } from "../../types.ts";
import { bonGoogleHarvestMerge } from "../google-harvest/merge.ts";
import type { BonScrapedPost } from "../google-harvest/parse.ts";
import { bonExpectedDurationMs } from "../../utils/expected_duration.ts";
import { bonReadReports, bonWriteReports } from "../../storage.ts";
import {
  bonDedupeHistory,
  bonFindReportKey,
  bonInvestigationResults,
  bonNormalizeReport,
} from "../../utils/history.ts";
import { bonGenerateRingId } from "../../utils/ring_id.ts";
import { bonNormalizeInvestigation } from "../../verdict.ts";
import { bonInvestigationMaybeAuto } from "../investigation/handlers.ts";

interface UserTag {
  username: string;
  count: number;
  verdict: string | null;
  confidence: number | null;
  investigationStatus: string | null;
  investigationStartedAt: number | null;
  botBouncerStatus: string | null;
  userStatus: string | null;
  ringId: string | null;
}

export async function bonRedditorsRecordReport(
  username: string,
  context: Record<string, unknown>
): Promise<{ count: number }> {
  const reports = await bonReadReports();

  const existing = bonNormalizeReport(reports[username]);
  const reportedAt = Date.now();
  const entry = { at: reportedAt, ...context };
  const history = bonDedupeHistory([...existing.history, entry]);

  reports[username] = {
    ...existing,
    count: history.length,
    lastReportedAt: reportedAt,
    history,
  };
  await bonWriteReports(reports);

  void bonInvestigationMaybeAuto(username);

  return { count: history.length };
}

export async function bonRedditorsGetState(
  username: string
): Promise<{ count: number; isBot: boolean }> {
  const reports = await bonReadReports();
  const count = reports[username]?.count ?? 0;
  return { count, isBot: count > 0 };
}

export async function bonRedditorsGetReport(
  username: string
): Promise<{ report: Report | null; expectedDurationMs: number | null }> {
  const reports = await bonReadReports();
  const expectedDurationMs = bonExpectedDurationMs(Object.values(reports));
  const key = bonFindReportKey(reports, username);

  if (!key) {
    return { report: null, expectedDurationMs };
  }

  return { report: reports[key]!, expectedDurationMs };
}

export async function bonRedditorsGetTags(): Promise<{
  tags: Record<string, UserTag>;
}> {
  const reports = await bonReadReports();

  const tags: Record<string, UserTag> = {};

  for (const [username, report] of Object.entries(reports)) {
    const tag = summarizeUserTag(username, report);
    if (tag) {
      tags[username] = tag;
    }
  }

  return { tags };
}

function summarizeUserTag(username: string, report: Report): UserTag | null {
  const investigation = bonNormalizeInvestigation(
    report.investigation,
    !!report.ringId
  );
  const results = bonInvestigationResults(investigation);
  const verdict = results?.verdict ?? null;
  const investigationStatus = investigation?.status ?? null;

  const hasSignal =
    verdict ||
    report.count > 0 ||
    report.userStatus ||
    report.botBouncerStatus ||
    report.ringId ||
    investigationStatus === "running";

  if (!hasSignal) {
    return null;
  }

  return {
    username,
    count: report.count,
    verdict,
    confidence: results?.confidence ?? null,
    investigationStatus,
    investigationStartedAt: investigation?.startedAt ?? null,
    botBouncerStatus: report.botBouncerStatus,
    userStatus: report.userStatus,
    ringId: report.ringId,
  };
}

export async function bonRedditorsGetAll(): Promise<{
  reports: Record<string, Report>;
}> {
  return { reports: await bonReadReports() };
}

export async function bonRedditorsClearAll(): Promise<{ ok: boolean }> {
  await bonWriteReports({});
  return { ok: true };
}

export async function bonRedditorsDelete(
  username: string
): Promise<{ ok: boolean; removed?: boolean; error?: string }> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false, error: "missing-username" };
  }

  const reports = await bonReadReports();
  if (!(trimmed in reports)) {
    return { ok: true, removed: false };
  }

  delete reports[trimmed];
  await bonWriteReports(reports);
  return { ok: true, removed: true };
}

export async function bonRedditorsSetUserStatus(
  username: string,
  status: Report["userStatus"]
): Promise<void> {
  const reports = await bonReadReports();

  if (!reports[username]) {
    return;
  }

  const existing = reports[username];
  if (existing.userStatus === status) {
    return;
  }

  reports[username] = {
    ...existing,
    userStatus: status,
    userStatusCheckedAt: Date.now(),
  };
  await bonWriteReports(reports);
}

export async function bonRedditorsUpdateProfileStats(
  username: string,
  createdAt: number | null,
  totalKarma: number | null
): Promise<void> {
  const reports = await bonReadReports();

  if (!reports[username]) {
    return;
  }

  const existing = reports[username];

  // Cake day is immutable, so only fill it when we don't already have one.
  // Karma changes over time — let the latest fetch win.
  const nextCreatedAt = existing.createdAt ?? createdAt ?? null;
  const nextKarma = totalKarma ?? existing.totalKarma ?? null;

  if (
    nextCreatedAt === existing.createdAt &&
    nextKarma === existing.totalKarma
  ) {
    return;
  }

  reports[username] = {
    ...existing,
    createdAt: nextCreatedAt,
    totalKarma: nextKarma,
  };
  await bonWriteReports(reports);
}

export async function bonRedditorsUpdatePostStatus(
  permalink: string,
  status: string
): Promise<void> {
  const reports = await bonReadReports();

  let updated = false;

  for (const [username, existing] of Object.entries(reports)) {
    let changed = false;

    const newHistory = existing.history.map((entry) => {
      if (
        entry.permalink &&
        entry.permalink === permalink &&
        entry.status !== status
      ) {
        changed = true;
        return {
          ...entry,
          status,
          statusCheckedAt: Date.now(),
        };
      }

      return entry;
    });

    if (changed) {
      reports[username] = { ...existing, history: newHistory };
      updated = true;
    }
  }

  if (updated) {
    await bonWriteReports(reports);
  }
}

const PERSONA_LABEL_SET = new Set<string>(BON_PERSONA_LABELS);

// Editable note + persona picks per username. The picker is multi-select,
// so `ratings` is an array (de-duped, preserves the user's pick order).
// Saving an empty rating set AND an empty note clears the record entirely
// so the detail pane returns to its "no notes yet" state instead of
// holding onto an empty placeholder.
export async function bonRedditorsSetUserNotes(
  username: string,
  patch: { ratings: string[]; note: string }
): Promise<{ ok: boolean; userNotes: UserNotes | null }> {
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username);
  if (!key) {
    return { ok: false, userNotes: null };
  }

  const seen = new Set<PersonaLabel>();
  const ratings: PersonaLabel[] = [];

  for (const entry of patch.ratings ?? []) {
    if (typeof entry !== "string" || !PERSONA_LABEL_SET.has(entry)) {
      continue;
    }

    const label = entry as PersonaLabel;
    if (seen.has(label)) {
      continue;
    }

    seen.add(label);
    ratings.push(label);
  }

  const note = (patch.note ?? "").trim();

  const userNotes: UserNotes | null =
    ratings.length === 0 && note === ""
      ? null
      : { ratings, note, updatedAt: Date.now() };

  reports[key] = { ...reports[key], userNotes };
  await bonWriteReports(reports);
  return { ok: true, userNotes };
}

// Merges a freshly scraped batch of SERP posts onto the user's report.
// Posts are unioned by canonical URL with the prior harvest (firstSeenAt
// stays put; lastSeenAt + mutable fields refresh). Creates the record if
// it doesn't exist yet — clicking "Search Google" on an uninvestigated
// user is a legitimate first-touch flow. Returns the merged envelope so
// callers can see what's now on file.
export async function bonRedditorsSetGoogleHarvest(
  username: string,
  query: string,
  incomingPosts: BonScrapedPost[]
): Promise<{ ok: boolean; postCount?: number }> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false };
  }

  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, trimmed) ?? trimmed;
  const existing = reports[key] ?? bonNormalizeReport(undefined);

  const merged = bonGoogleHarvestMerge({
    existing: existing.googleHarvest,
    incomingPosts,
    query,
    now: Date.now(),
  });

  reports[key] = { ...existing, googleHarvest: merged };
  await bonWriteReports(reports);
  return { ok: true, postCount: merged.posts.length };
}

export async function bonRedditorsSetBotBouncerStatus(
  username: string,
  status: Report["botBouncerStatus"]
): Promise<void> {
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username);

  if (!key) {
    return;
  }

  const existing = reports[key];
  if (existing.botBouncerStatus === status) {
    return;
  }

  reports[key] = {
    ...existing,
    botBouncerStatus: status,
    botBouncerCheckedAt: Date.now(),
  };
  await bonWriteReports(reports);
}

export async function bonRedditorsLinkRing(
  usernames: string[]
): Promise<{ ok: boolean; ringId?: string; error?: string }> {
  const cleaned = usernames.filter(
    (name) => typeof name === "string" && name.length > 0
  );

  if (cleaned.length < 2) {
    return { ok: false, error: "need-at-least-two" };
  }

  const reports = await bonReadReports();
  const keys: string[] = [];

  for (const username of cleaned) {
    const key = bonFindReportKey(reports, username);
    if (!key) {
      return { ok: false, error: `unknown-user:${username}` };
    }

    keys.push(key);
  }

  const existingRingIds = new Set<string>();

  for (const key of keys) {
    const ringId = reports[key].ringId;
    if (ringId) {
      existingRingIds.add(ringId);
    }
  }

  if (existingRingIds.size > 1) {
    return { ok: false, error: "multiple-existing-rings" };
  }

  const ringId =
    existingRingIds.size === 1
      ? [...existingRingIds][0]
      : bonGenerateRingId(collectExistingRingIds(reports));

  for (const key of keys) {
    if (reports[key].ringId === ringId) {
      continue;
    }

    reports[key] = { ...reports[key], ringId };
  }

  await bonWriteReports(reports);
  return { ok: true, ringId };
}

export async function bonRedditorsUnlinkRing(
  usernames: string[]
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = usernames.filter(
    (name) => typeof name === "string" && name.length > 0
  );

  if (cleaned.length === 0) {
    return { ok: false, error: "no-usernames" };
  }

  const reports = await bonReadReports();
  let changed = false;

  for (const username of cleaned) {
    const key = bonFindReportKey(reports, username);
    if (!key) {
      continue;
    }

    if (reports[key].ringId === null) {
      continue;
    }

    reports[key] = { ...reports[key], ringId: null };
    changed = true;
  }

  if (changed) {
    await bonWriteReports(reports);
  }

  return { ok: true };
}

function collectExistingRingIds(reports: Record<string, Report>): Set<string> {
  const out = new Set<string>();

  for (const report of Object.values(reports)) {
    if (report.ringId) {
      out.add(report.ringId);
    }
  }

  return out;
}
