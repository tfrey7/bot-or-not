// Canonical-shape helpers for Report records.
//
// normalizeReport is the source of trust: every Report field always
// present, Investigation canonicalized so consumers can drop defensive
// `Array.isArray` / `typeof === "number"` / `?? null` checks. The storage
// adapter (`src/storage/`) runs every read through it; sync's import
// parser does the same on incoming backups.

import { PERSONA_LABELS } from "../factors.ts";
import { QUEUE_PRIORITY } from "../queue_priority.ts";
import type {
  Factor,
  GoogleHarvest,
  HistoryEntry,
  Investigation,
  InvestigationResults,
  PassiveHarvest,
  Persona,
  PersonaLabel,
  RedditMetrics,
  Report,
  RunSnapshot,
  UserNotes,
  Verdict,
} from "../types.ts";
import { normalizeDemographics } from "./demographics.ts";
import { normalizeRegionInference } from "./region_inference.ts";

function mergeHistoryEntries(a: HistoryEntry, b: HistoryEntry): HistoryEntry {
  const newer = (b?.at || 0) >= (a?.at || 0) ? b : a;
  const older = newer === a ? b : a;

  return {
    ...older,
    ...newer,
    status: newer.status || older.status,
    statusCheckedAt: newer.statusCheckedAt || older.statusCheckedAt,
  };
}

export function dedupeHistory(history: HistoryEntry[]): HistoryEntry[] {
  const seen = new Map<string, number>();
  const out: HistoryEntry[] = [];

  for (const entry of history) {
    const key = entry?.permalink;
    if (key && seen.has(key)) {
      const index = seen.get(key)!;
      out[index] = mergeHistoryEntries(out[index], entry);
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
export function normalizeReport(value: unknown): Report {
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
      userNotes: null,
      googleHarvest: null,
      profileHidden: false,
      passiveHarvest: null,
    };
  }

  const record = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const history = dedupeHistory(
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
    userNotes: canonicalizeUserNotes(record.userNotes),
    googleHarvest: canonicalizeGoogleHarvest(record.googleHarvest),
    profileHidden: record.profileHidden === true,
    passiveHarvest: canonicalizePassiveHarvest(record.passiveHarvest),
  };
}

function canonicalizePassiveHarvest(value: unknown): PassiveHarvest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as PassiveHarvest;
}

// We trust our own write path to produce the right shape — the canonicalizer
// only defends against legacy records (where the field is missing) and
// against the trivial "wrong type entirely" case (someone hand-edited
// storage). Field-by-field validation isn't worth the lines.
function canonicalizeGoogleHarvest(value: unknown): GoogleHarvest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as GoogleHarvest;
}

const PERSONA_LABEL_SET = new Set<string>(PERSONA_LABELS);

function canonicalizeUserNotes(value: unknown): UserNotes | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  // Accept legacy single-rating shape (`rating: PersonaLabel | null`) and
  // current multi-rating shape (`ratings: PersonaLabel[]`). Migration
  // rewrites the stored form to `ratings`; the legacy branch keeps newly
  // arriving sync payloads from older installs working until they catch up.
  const seen = new Set<PersonaLabel>();
  const ratings: PersonaLabel[] = [];

  const rawRatings = record.ratings;
  if (Array.isArray(rawRatings)) {
    for (const entry of rawRatings) {
      if (typeof entry === "string" && PERSONA_LABEL_SET.has(entry)) {
        const label = entry as PersonaLabel;
        if (!seen.has(label)) {
          seen.add(label);
          ratings.push(label);
        }
      }
    }
  } else {
    const rawRating = record.rating;
    if (typeof rawRating === "string" && PERSONA_LABEL_SET.has(rawRating)) {
      ratings.push(rawRating as PersonaLabel);
    }
  }

  const note = typeof record.note === "string" ? record.note : "";
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0;

  if (ratings.length === 0 && note === "") {
    return null;
  }

  return { ratings, note, updatedAt };
}

// Internal: turn whatever was on disk into the canonical Investigation shape
// (or null). Discriminates on `status` — the "done" variant gets a populated
// `results`; other variants get `results: null`. Legacy stored shape had
// result fields at the top level; we lift them into `results` when status
// is "done" and discard them otherwise (the carryover into queued/running
// was never read by consumers).
function canonicalizeInvestigation(value: unknown): Investigation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const investigation = value as Record<string, unknown>;
  const status = investigation.status as Investigation["status"];
  if (
    status !== "queued" &&
    status !== "running" &&
    status !== "done" &&
    status !== "error"
  ) {
    return null;
  }

  const lifecycle = {
    queuedAt:
      typeof investigation.queuedAt === "number"
        ? investigation.queuedAt
        : null,
    priority:
      typeof investigation.priority === "number"
        ? investigation.priority
        : QUEUE_PRIORITY.bulk,
    notBefore:
      typeof investigation.notBefore === "number"
        ? investigation.notBefore
        : null,
    startedAt:
      typeof investigation.startedAt === "number"
        ? investigation.startedAt
        : null,
    durationMs:
      typeof investigation.durationMs === "number"
        ? investigation.durationMs
        : null,
    error: typeof investigation.error === "string" ? investigation.error : null,
    runs: Array.isArray(investigation.runs)
      ? (investigation.runs as RunSnapshot[]).map(canonicalizeRunSnapshot)
      : [],
    attempts:
      typeof investigation.attempts === "number" ? investigation.attempts : 0,
    redditMetrics: canonicalizeRedditMetrics(investigation.redditMetrics),
  };

  if (status !== "done") {
    return { status, ...lifecycle, results: null };
  }

  // "done" status — lift result fields off the legacy top level (or read
  // from `results` if already migrated to the discriminated shape).
  const resultsSource =
    investigation.results && typeof investigation.results === "object"
      ? (investigation.results as Record<string, unknown>)
      : investigation;

  const results: InvestigationResults = {
    runAt:
      typeof resultsSource.runAt === "number"
        ? resultsSource.runAt
        : Date.now(),
    durationMs:
      typeof resultsSource.durationMs === "number"
        ? resultsSource.durationMs
        : (lifecycle.durationMs ?? 0),
    verdict: (resultsSource.verdict as Verdict | undefined) ?? "uncertain",
    confidence:
      typeof resultsSource.confidence === "number"
        ? resultsSource.confidence
        : 0,
    botProbability:
      typeof resultsSource.botProbability === "number"
        ? resultsSource.botProbability
        : 0.5,
    factors: Array.isArray(resultsSource.factors)
      ? (resultsSource.factors as unknown[]).map(canonicalizeFactor)
      : [],
    persona: (resultsSource.persona as Persona | null) ?? null,
    region: normalizeRegionInference(resultsSource.region),
    demographics: normalizeDemographics(resultsSource.demographics),
    summary:
      typeof resultsSource.summary === "string" ? resultsSource.summary : "",
    model: typeof resultsSource.model === "string" ? resultsSource.model : "",
    usage:
      (resultsSource.usage as InvestigationResults["usage"] | undefined) ??
      null,
    costUsd:
      typeof resultsSource.costUsd === "number" ? resultsSource.costUsd : null,
    postsFetched:
      typeof resultsSource.postsFetched === "number"
        ? resultsSource.postsFetched
        : 0,
    commentsFetched:
      typeof resultsSource.commentsFetched === "number"
        ? resultsSource.commentsFetched
        : 0,
    accountCreatedAt:
      typeof resultsSource.accountCreatedAt === "string"
        ? resultsSource.accountCreatedAt
        : null,
    accountAgeDays:
      typeof resultsSource.accountAgeDays === "number"
        ? resultsSource.accountAgeDays
        : null,
  };

  // Pull redditMetrics off the top-level if the lifecycle field didn't pick
  // it up from a legacy record (some old records stashed it next to the
  // result fields).
  const mergedLifecycle = {
    ...lifecycle,
    redditMetrics:
      lifecycle.redditMetrics ??
      canonicalizeRedditMetrics(resultsSource.redditMetrics),
  };

  return { status: "done", ...mergedLifecycle, results };
}

// Older stored records may have Factor entries missing `reasoning` / `evidence`
// from when those were optional. Default to empty so consumers can rely on
// them being present. Cheap shape probe first — every read of every report
// runs this per-factor, so the steady-state path stays an O(1) cast.
function canonicalizeFactor(value: unknown): Factor {
  if (isCanonicalFactor(value)) {
    return value;
  }

  const record = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;

  return {
    key: typeof record.key === "string" ? record.key : "",
    score: typeof record.score === "number" ? record.score : 0,
    confidence: typeof record.confidence === "number" ? record.confidence : 0,
    reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
    evidence:
      typeof record.evidence === "string" || Array.isArray(record.evidence)
        ? (record.evidence as string | string[])
        : "",
  };
}

function isCanonicalFactor(value: unknown): value is Factor {
  if (!value || typeof value !== "object") {
    return false;
  }

  const f = value as Record<string, unknown>;
  return (
    typeof f.key === "string" &&
    typeof f.score === "number" &&
    typeof f.confidence === "number" &&
    typeof f.reasoning === "string" &&
    (typeof f.evidence === "string" || Array.isArray(f.evidence))
  );
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
    postsFetched:
      typeof record.postsFetched === "number" ? record.postsFetched : 0,
    commentsFetched:
      typeof record.commentsFetched === "number" ? record.commentsFetched : 0,
    redditMetrics: canonicalizeRedditMetrics(record.redditMetrics),
    error: typeof record.error === "string" ? record.error : null,
  };
}

// Case-insensitive username lookup — Reddit's routing is case-insensitive but
// our storage keys preserve whatever casing was first seen.
export function findReportKey(
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

// Narrowing helpers for the discriminated Investigation union. Replaces
// the inline `inv?.status === "done" ? inv.results : null` repeated at
// every consumer site.

function isInvestigationDone(
  investigation: Investigation | null | undefined
): investigation is Extract<Investigation, { status: "done" }> {
  return investigation?.status === "done";
}

export function investigationResults(
  investigation: Investigation | null | undefined
): InvestigationResults | null {
  return isInvestigationDone(investigation) ? investigation.results : null;
}

// Extracts a runs[] snapshot from a terminated investigation so historical
// timing/cost data survives across re-runs. Reads result fields when the
// investigation is "done"; for "error" snapshots the result fields stay
// null since the run never produced them.
export function snapshotRun(
  investigation: Investigation,
  status: RunSnapshot["status"]
): RunSnapshot {
  if (investigation.status === "done") {
    return {
      runAt: investigation.results.runAt,
      durationMs: investigation.results.durationMs,
      status,
      verdict: investigation.results.verdict,
      confidence: investigation.results.confidence,
      botProbability: investigation.results.botProbability,
      model: investigation.results.model,
      usage: investigation.results.usage,
      costUsd: investigation.results.costUsd,
      postsFetched: investigation.results.postsFetched,
      commentsFetched: investigation.results.commentsFetched,
      redditMetrics: investigation.redditMetrics,
      error: status === "error" ? investigation.error : null,
    };
  }

  return {
    runAt: Date.now(),
    durationMs: investigation.durationMs,
    status,
    verdict: null,
    confidence: null,
    botProbability: null,
    model: null,
    usage: null,
    costUsd: null,
    postsFetched: 0,
    commentsFetched: 0,
    redditMetrics: investigation.redditMetrics,
    error: status === "error" ? investigation.error : null,
  };
}
