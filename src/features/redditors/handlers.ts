// Background-context handlers for the reports store. The dispatcher in
// background.ts unpacks each message and calls the matching function here.
// Reports records own the reported-account state — count, history, ring
// membership, last-seen statuses — so every read/write of those fields
// lives in this file.

import { PERSONA_LABELS } from "../../factors.ts";
import type { PersonaLabel, Report, UserNotes } from "../../types.ts";
import { googleHarvestMerge, type ScrapedPost } from "../google-harvest";
import { computeExpectedDurationMs } from "../../utils/expected_duration.ts";
import {
  readReport,
  readReportSummaries,
  readReports,
  updateReport,
  writeReports,
} from "../../storage.ts";
import {
  dedupeHistory,
  findReportKey,
  investigationResults,
  normalizeReport,
} from "../../utils/history.ts";
import { generateRingId } from "../../utils/ring_id.ts";
import { normalizeInvestigation } from "../../verdict.ts";
import { investigationMaybeAuto } from "../investigation";

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

export async function redditorsRecordReport(
  username: string,
  context: Record<string, unknown>
): Promise<{ count: number }> {
  let count = 0;

  await updateReport(username, (current) => {
    const existing = current ?? normalizeReport(undefined);
    const reportedAt = Date.now();
    const entry = { at: reportedAt, ...context };
    const history = dedupeHistory([...existing.history, entry]);
    count = history.length;

    return {
      ...existing,
      count: history.length,
      lastReportedAt: reportedAt,
      history,
    };
  });

  void investigationMaybeAuto(username);

  return { count };
}

export async function redditorsGetState(
  username: string
): Promise<{ count: number; isBot: boolean }> {
  const count = (await readReport(username))?.count ?? 0;
  return { count, isBot: count > 0 };
}

// The median completed-run duration changes only when an investigation
// finishes, so a short-lived memo keeps the per-record detail fetch (one
// storage read) from paying for a full-store assemble just to recompute it.
let expectedDurationMemo: number | null = null;
let expectedDurationMemoAt = 0;
const EXPECTED_DURATION_MEMO_MS = 30_000;

async function memoizedExpectedDurationMs(): Promise<number | null> {
  const now = Date.now();
  if (
    expectedDurationMemoAt !== 0 &&
    now - expectedDurationMemoAt < EXPECTED_DURATION_MEMO_MS
  ) {
    return expectedDurationMemo;
  }

  const reports = await readReports();
  expectedDurationMemo = computeExpectedDurationMs(Object.values(reports));
  expectedDurationMemoAt = now;

  return expectedDurationMemo;
}

export async function redditorsGetReport(
  username: string
): Promise<{ report: Report | null; expectedDurationMs: number | null }> {
  const report = await readReport(username);
  const expectedDurationMs = await memoizedExpectedDurationMs();

  return { report, expectedDurationMs };
}

export async function redditorsGetSummaries(): Promise<{
  reports: Record<string, Report>;
}> {
  return { reports: await readReportSummaries() };
}

export async function redditorsGetTags(): Promise<{
  tags: Record<string, UserTag>;
}> {
  const reports = await readReports();

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
  const investigation = normalizeInvestigation(
    report.investigation,
    !!report.ringId
  );
  const results = investigationResults(investigation);
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

export async function redditorsGetAll(): Promise<{
  reports: Record<string, Report>;
}> {
  return { reports: await readReports() };
}

export async function redditorsClearAll(): Promise<{ ok: boolean }> {
  await writeReports({});
  return { ok: true };
}

export async function redditorsDelete(
  username: string
): Promise<{ ok: boolean; removed?: boolean; error?: string }> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false, error: "missing-username" };
  }

  let removed = false;
  await updateReport(trimmed, (current) => {
    if (current) {
      removed = true;
    }

    return null;
  });

  return { ok: true, removed };
}

export async function redditorsSetUserStatus(
  username: string,
  status: Report["userStatus"]
): Promise<void> {
  await updateReport(username, (current) => {
    if (!current) {
      return null;
    }

    if (current.userStatus === status) {
      return current;
    }

    return {
      ...current,
      userStatus: status,
      userStatusCheckedAt: Date.now(),
    };
  });
}

export async function redditorsUpdateProfileStats(
  username: string,
  createdAt: number | null,
  totalKarma: number | null
): Promise<void> {
  await updateReport(username, (current) => {
    if (!current) {
      return null;
    }

    // Cake day is immutable, so only fill it when we don't already have one.
    // Karma changes over time — let the latest fetch win.
    const nextCreatedAt = current.createdAt ?? createdAt ?? null;
    const nextKarma = totalKarma ?? current.totalKarma ?? null;

    if (
      nextCreatedAt === current.createdAt &&
      nextKarma === current.totalKarma
    ) {
      return current;
    }

    return {
      ...current,
      createdAt: nextCreatedAt,
      totalKarma: nextKarma,
    };
  });
}

export async function redditorsUpdatePostStatus(
  permalink: string,
  status: string
): Promise<void> {
  const reports = await readReports();

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
    await writeReports(reports);
  }
}

const PERSONA_LABEL_SET = new Set<string>(PERSONA_LABELS);

// Editable note + persona picks per username. The picker is multi-select,
// so `ratings` is an array (de-duped, preserves the user's pick order).
// Saving an empty rating set AND an empty note clears the record entirely
// so the detail pane returns to its "no notes yet" state instead of
// holding onto an empty placeholder.
export async function redditorsSetUserNotes(
  username: string,
  patch: { ratings: string[]; note: string }
): Promise<{ ok: boolean; userNotes: UserNotes | null }> {
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

  let applied = false;
  await updateReport(username, (current) => {
    if (!current) {
      return null;
    }

    applied = true;
    return { ...current, userNotes };
  });

  if (!applied) {
    return { ok: false, userNotes: null };
  }

  return { ok: true, userNotes };
}

// Merges a freshly scraped batch of SERP posts onto the user's report.
// Posts are unioned by canonical URL with the prior harvest (firstSeenAt
// stays put; lastSeenAt + mutable fields refresh). Creates the record if
// it doesn't exist yet — clicking "Search Google" on an uninvestigated
// user is a legitimate first-touch flow. Returns the merged envelope so
// callers can see what's now on file.
export async function redditorsSetGoogleHarvest(
  username: string,
  query: string,
  incomingPosts: ScrapedPost[]
): Promise<{ ok: boolean; postCount?: number }> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false };
  }

  let postCount = 0;
  await updateReport(trimmed, (current) => {
    const existing = current ?? normalizeReport(undefined);
    const merged = googleHarvestMerge({
      existing: existing.googleHarvest,
      incomingPosts,
      query,
      now: Date.now(),
    });
    postCount = merged.posts.length;

    return { ...existing, googleHarvest: merged };
  });

  return { ok: true, postCount };
}

export async function redditorsSetBotBouncerStatus(
  username: string,
  status: Report["botBouncerStatus"]
): Promise<void> {
  await updateReport(username, (current) => {
    if (!current) {
      return null;
    }

    if (current.botBouncerStatus === status) {
      return current;
    }

    return {
      ...current,
      botBouncerStatus: status,
      botBouncerCheckedAt: Date.now(),
    };
  });
}

export async function redditorsLinkRing(
  usernames: string[]
): Promise<{ ok: boolean; ringId?: string; error?: string }> {
  const cleaned = usernames.filter(
    (name) => typeof name === "string" && name.length > 0
  );

  if (cleaned.length < 2) {
    return { ok: false, error: "need-at-least-two" };
  }

  const reports = await readReports();
  const keys: string[] = [];

  for (const username of cleaned) {
    const key = findReportKey(reports, username);
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
      : generateRingId(collectExistingRingIds(reports));

  for (const key of keys) {
    if (reports[key].ringId === ringId) {
      continue;
    }

    reports[key] = { ...reports[key], ringId };
  }

  await writeReports(reports);
  return { ok: true, ringId };
}

export async function redditorsUnlinkRing(
  usernames: string[]
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = usernames.filter(
    (name) => typeof name === "string" && name.length > 0
  );

  if (cleaned.length === 0) {
    return { ok: false, error: "no-usernames" };
  }

  const reports = await readReports();
  let changed = false;

  for (const username of cleaned) {
    const key = findReportKey(reports, username);
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
    await writeReports(reports);
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
