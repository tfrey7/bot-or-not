// Pure data-shape helpers for the report record stored in browser.storage.
// No I/O — callers are responsible for reading/writing storage.

import type {
  HistoryEntry,
  Investigation,
  Report,
  RunSnapshot,
} from "../types.ts";

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
      const idx = seen.get(key)!;
      out[idx] = bonMergeHistoryEntries(out[idx], entry);
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
      investigation: null,
    };
  }
  const v = (value && typeof value === "object" ? value : {}) as Partial<
    Record<string, unknown>
  >;
  const history = bonDedupeHistory(
    Array.isArray(v.history) ? (v.history as HistoryEntry[]) : []
  );
  const rawCount = typeof v.count === "number" ? v.count : 0;
  const count = history.length > 0 ? history.length : rawCount;
  return {
    count,
    lastReportedAt: (v.lastReportedAt as number) ?? 0,
    history,
    userStatus: (v.userStatus as Report["userStatus"]) ?? null,
    userStatusCheckedAt: (v.userStatusCheckedAt as number) ?? 0,
    createdAt: (v.createdAt as number | null) ?? null,
    botBouncerStatus:
      (v.botBouncerStatus as Report["botBouncerStatus"]) ?? null,
    botBouncerCheckedAt: (v.botBouncerCheckedAt as number) ?? 0,
    investigation: (v.investigation as Investigation | null) ?? null,
    activityData: (v.activityData as Report["activityData"]) ?? null,
  };
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
  for (const k of Object.keys(reports)) {
    if (k.toLowerCase() === target) {
      return k;
    }
  }
  return null;
}

// Extracts a runs[] snapshot from a terminated investigation so historical
// timing/cost data survives across re-runs.
export function bonSnapshotRun(
  inv: Investigation,
  status: RunSnapshot["status"]
): RunSnapshot {
  return {
    runAt: inv.runAt || Date.now(),
    durationMs: typeof inv.durationMs === "number" ? inv.durationMs : null,
    status,
    verdict: inv.verdict || null,
    confidence: typeof inv.confidence === "number" ? inv.confidence : null,
    botProbability:
      typeof inv.botProbability === "number" ? inv.botProbability : null,
    model: inv.model || null,
    usage: inv.usage || null,
    costUsd: typeof inv.costUsd === "number" ? inv.costUsd : null,
    webSearchCount: inv.webSearchCount || 0,
    postsFetched: inv.postsFetched || 0,
    commentsFetched: inv.commentsFetched || 0,
    error: status === "error" ? inv.error || null : null,
  };
}
