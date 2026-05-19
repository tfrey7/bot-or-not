// Storage I/O + canonical-shape helpers for Report records.
//
// bonReadReports / bonWriteReports are the only sanctioned entry points
// for `browser.storage.local.{get,set}("reports")`. They centralize the
// `unknown → Record<string, Report>` cast in one place, where it can run
// through bonNormalizeReport to actually produce the canonical shape.
//
// bonNormalizeReport is the source of trust: every Report field always
// present, Investigation canonicalized so consumers can drop defensive
// `Array.isArray` / `typeof === "number"` / `?? null` checks.

import type {
  Factor,
  HistoryEntry,
  Investigation,
  InvestigationStatus,
  Persona,
  RedditMetrics,
  Report,
  RunSnapshot,
} from "../types.ts";
import { bonNormalizeRegionInference } from "./region_inference.ts";

export function bonMergeHistoryEntries(
  a: HistoryEntry,
  b: HistoryEntry
): HistoryEntry {
  const newer = (b?.at || 0) >= (a?.at || 0) ? b : a;
  const older = newer === a ? b : a;

  return {
    ...older,
    ...newer,
    status: newer.status || older.status,
    statusCheckedAt: newer.statusCheckedAt || older.statusCheckedAt,
  };
}

export function bonDedupeHistory(history: HistoryEntry[]): HistoryEntry[] {
  const seen = new Map<string, number>();
  const out: HistoryEntry[] = [];

  for (const entry of history) {
    const key = entry?.permalink;
    if (key && seen.has(key)) {
      const index = seen.get(key)!;
      out[index] = bonMergeHistoryEntries(out[index], entry);
    } else {
      if (key) {
        seen.set(key, out.length);
      }

      out.push({ ...entry });
    }
  }

  return out;
}

// Coerces a legacy (count-only) or modern report record into the canonical
// shape, defaulting missing fields. Idempotent.
export function bonNormalizeReport(value: unknown): Report {
  if (typeof value === "number") {
    return {
      count: value,
      lastReportedAt: 0,
      history: [],
      userStatus: null,
      userStatusCheckedAt: 0,
      createdAt: null,
      totalKarma: null,
      botBouncerStatus: null,
      botBouncerCheckedAt: 0,
      investigation: null,
      activityData: null,
      ringId: null,
    };
  }

  const record = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const history = bonDedupeHistory(
    Array.isArray(record.history) ? (record.history as HistoryEntry[]) : []
  );
  const rawCount = typeof record.count === "number" ? record.count : 0;
  const count = history.length > 0 ? history.length : rawCount;

  return {
    count,
    lastReportedAt:
      typeof record.lastReportedAt === "number" ? record.lastReportedAt : 0,
    history,
    userStatus: (record.userStatus as Report["userStatus"]) ?? null,
    userStatusCheckedAt:
      typeof record.userStatusCheckedAt === "number"
        ? record.userStatusCheckedAt
        : 0,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : null,
    totalKarma:
      typeof record.totalKarma === "number" ? record.totalKarma : null,
    botBouncerStatus:
      (record.botBouncerStatus as Report["botBouncerStatus"]) ?? null,
    botBouncerCheckedAt:
      typeof record.botBouncerCheckedAt === "number"
        ? record.botBouncerCheckedAt
        : 0,
    investigation: canonicalizeInvestigation(record.investigation),
    activityData: (record.activityData as Report["activityData"]) ?? null,
    ringId: typeof record.ringId === "string" ? record.ringId : null,
  };
}

// Internal: turn whatever was on disk into the canonical Investigation shape
// (or null). Every field always set after this; consumers gate on `status`
// to know which result fields hold real data vs. null/empty defaults.
function canonicalizeInvestigation(value: unknown): Investigation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const investigation = value as Record<string, unknown>;
  const status = investigation.status as Investigation["status"];
  if (status !== "running" && status !== "done" && status !== "error") {
    return null;
  }

  return {
    status,
    startedAt:
      typeof investigation.startedAt === "number"
        ? investigation.startedAt
        : null,
    runAt: typeof investigation.runAt === "number" ? investigation.runAt : null,
    durationMs:
      typeof investigation.durationMs === "number"
        ? investigation.durationMs
        : null,
    error: typeof investigation.error === "string" ? investigation.error : null,
    verdict: (investigation.verdict as Investigation["verdict"]) ?? null,
    confidence:
      typeof investigation.confidence === "number"
        ? investigation.confidence
        : null,
    botProbability:
      typeof investigation.botProbability === "number"
        ? investigation.botProbability
        : null,
    factors: Array.isArray(investigation.factors)
      ? (investigation.factors as Factor[])
      : [],
    persona: (investigation.persona as Persona | null) ?? null,
    region: bonNormalizeRegionInference(investigation.region),
    summary:
      typeof investigation.summary === "string" ? investigation.summary : "",
    model: typeof investigation.model === "string" ? investigation.model : null,
    usage: (investigation.usage as Investigation["usage"]) ?? null,
    webSearchCount:
      typeof investigation.webSearchCount === "number"
        ? investigation.webSearchCount
        : 0,
    costUsd:
      typeof investigation.costUsd === "number" ? investigation.costUsd : null,
    postsFetched:
      typeof investigation.postsFetched === "number"
        ? investigation.postsFetched
        : 0,
    commentsFetched:
      typeof investigation.commentsFetched === "number"
        ? investigation.commentsFetched
        : 0,
    accountCreatedAt:
      typeof investigation.accountCreatedAt === "string"
        ? investigation.accountCreatedAt
        : null,
    accountAgeDays:
      typeof investigation.accountAgeDays === "number"
        ? investigation.accountAgeDays
        : null,
    redditMetrics: canonicalizeRedditMetrics(investigation.redditMetrics),
    runs: Array.isArray(investigation.runs)
      ? (investigation.runs as RunSnapshot[]).map(canonicalizeRunSnapshot)
      : [],
  };
}

function canonicalizeRedditMetrics(value: unknown): RedditMetrics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const fetches = Array.isArray(record.fetches)
    ? (record.fetches as RedditMetrics["fetches"])
    : null;

  if (!fetches) {
    return null;
  }

  return {
    fetches,
    totalDurationMs:
      typeof record.totalDurationMs === "number" ? record.totalDurationMs : 0,
  };
}

// Older RunSnapshot entries on disk predate redditMetrics. Mapping
// through the canonicalizer fills in the missing field so downstream
// consumers can read `run.redditMetrics` without an `in` check.
function canonicalizeRunSnapshot(value: unknown): RunSnapshot {
  const record = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;

  return {
    runAt: typeof record.runAt === "number" ? record.runAt : 0,
    durationMs:
      typeof record.durationMs === "number" ? record.durationMs : null,
    status: (record.status as RunSnapshot["status"]) ?? "done",
    verdict: (record.verdict as RunSnapshot["verdict"]) ?? null,
    confidence:
      typeof record.confidence === "number" ? record.confidence : null,
    botProbability:
      typeof record.botProbability === "number" ? record.botProbability : null,
    model: typeof record.model === "string" ? record.model : null,
    usage: (record.usage as RunSnapshot["usage"]) ?? null,
    costUsd: typeof record.costUsd === "number" ? record.costUsd : null,
    webSearchCount:
      typeof record.webSearchCount === "number" ? record.webSearchCount : 0,
    postsFetched:
      typeof record.postsFetched === "number" ? record.postsFetched : 0,
    commentsFetched:
      typeof record.commentsFetched === "number" ? record.commentsFetched : 0,
    redditMetrics: canonicalizeRedditMetrics(record.redditMetrics),
    error: typeof record.error === "string" ? record.error : null,
  };
}

// Build a fresh Investigation with all fields at default. Callers (only
// setInvestigationState should be one) layer prev + patch on top.
export function bonFreshInvestigation(
  status: InvestigationStatus
): Investigation {
  return {
    status,
    startedAt: null,
    runAt: null,
    durationMs: null,
    error: null,
    verdict: null,
    confidence: null,
    botProbability: null,
    factors: [],
    persona: null,
    region: null,
    summary: "",
    model: null,
    usage: null,
    webSearchCount: 0,
    costUsd: null,
    postsFetched: 0,
    commentsFetched: 0,
    accountCreatedAt: null,
    accountAgeDays: null,
    redditMetrics: null,
    runs: [],
  };
}

// Sanctioned storage entry points. Reads run through bonNormalizeReport so
// every callsite gets the canonical shape — no `as Report` lies elsewhere.
export async function bonReadReports(): Promise<Record<string, Report>> {
  const raw = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, unknown>;
  };
  const out: Record<string, Report> = {};

  for (const [username, value] of Object.entries(raw.reports ?? {})) {
    out[username] = bonNormalizeReport(value);
  }

  return out;
}

export async function bonWriteReports(
  reports: Record<string, Report>
): Promise<void> {
  await browser.storage.local.set({ reports });
}

// Case-insensitive username lookup — Reddit's routing is case-insensitive but
// our storage keys preserve whatever casing was first seen.
export function bonFindReportKey(
  reports: Record<string, unknown>,
  username: string
): string | null {
  if (reports[username]) {
    return username;
  }

  const target = username.toLowerCase();

  for (const key of Object.keys(reports)) {
    if (key.toLowerCase() === target) {
      return key;
    }
  }

  return null;
}

// Extracts a runs[] snapshot from a terminated investigation so historical
// timing/cost data survives across re-runs.
export function bonSnapshotRun(
  investigation: Investigation,
  status: RunSnapshot["status"]
): RunSnapshot {
  return {
    runAt: investigation.runAt ?? Date.now(),
    durationMs: investigation.durationMs,
    status,
    verdict: investigation.verdict,
    confidence: investigation.confidence,
    botProbability: investigation.botProbability,
    model: investigation.model,
    usage: investigation.usage,
    costUsd: investigation.costUsd,
    webSearchCount: investigation.webSearchCount,
    postsFetched: investigation.postsFetched,
    commentsFetched: investigation.commentsFetched,
    redditMetrics: investigation.redditMetrics,
    error: status === "error" ? investigation.error : null,
  };
}
