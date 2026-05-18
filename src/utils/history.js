// Pure data-shape helpers for the report record stored in browser.storage.
// No I/O — callers are responsible for reading/writing storage.

(function () {
  function bonMergeHistoryEntries(a, b) {
    const newer = (b?.at || 0) >= (a?.at || 0) ? b : a;
    const older = newer === a ? b : a;
    return {
      ...older,
      ...newer,
      status: newer.status || older.status,
      statusCheckedAt: newer.statusCheckedAt || older.statusCheckedAt,
    };
  }

  function bonDedupeHistory(history) {
    const seen = new Map();
    const out = [];
    for (const entry of history) {
      const key = entry?.permalink;
      if (key && seen.has(key)) {
        const idx = seen.get(key);
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
  function bonNormalizeReport(value) {
    if (typeof value === "number") {
      return {
        count: value,
        lastReportedAt: 0,
        history: [],
        userStatus: null,
        userStatusCheckedAt: 0,
        createdAt: null,
      };
    }
    const history = bonDedupeHistory(
      Array.isArray(value?.history) ? value.history : []
    );
    const count = history.length > 0 ? history.length : (value?.count ?? 0);
    return {
      count,
      lastReportedAt: value?.lastReportedAt ?? 0,
      history,
      userStatus: value?.userStatus ?? null,
      userStatusCheckedAt: value?.userStatusCheckedAt ?? 0,
      createdAt: value?.createdAt ?? null,
      botBouncerStatus: value?.botBouncerStatus ?? null,
      botBouncerCheckedAt: value?.botBouncerCheckedAt ?? 0,
      investigation: value?.investigation ?? null,
      activityData: value?.activityData ?? null,
    };
  }

  // Case-insensitive username lookup — Reddit's routing is case-insensitive but
  // our storage keys preserve whatever casing was first seen.
  function bonFindReportKey(reports, username) {
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
  function bonSnapshotRun(inv, status) {
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

  globalThis.bonMergeHistoryEntries = bonMergeHistoryEntries;
  globalThis.bonDedupeHistory = bonDedupeHistory;
  globalThis.bonNormalizeReport = bonNormalizeReport;
  globalThis.bonFindReportKey = bonFindReportKey;
  globalThis.bonSnapshotRun = bonSnapshotRun;
})();
