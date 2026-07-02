// StorageAdapter backed by `browser.storage.local` — the implementation used
// inside the extension's three execution contexts.

import type { LlmVendor } from "../llm/index.ts";
import type { Report, SubredditReport } from "../types.ts";
import { findReportKey, normalizeReport } from "../utils/history.ts";
import { slimReport } from "./logic.ts";
import type {
  ApiKeyMap,
  BlocklistCleanupState,
  LlmSelection,
  ReportUpdater,
  StorageAdapter,
  SyncConfig,
} from "./types.ts";

const EMPTY_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  gistId: null,
  token: null,
  lastSyncedAt: null,
  lastError: null,
};

// Each report record lives under its own `report:<username>` key rather
// than in one monolithic `reports` blob. A single-record write then fires
// storage.onChanged carrying only that record (tens of KB) instead of the
// entire store (megabytes) — the difference between every Reddit/Google tab
// janking on each investigation step and not. The prefix preserves the
// original-case username so reports-page display casing is unchanged.
const REPORT_KEY_PREFIX = "report:";

// The pre-split monolithic blob. Read-folded by readReports/readReport until
// the reports_per_key migration removes it, so the store stays coherent if a
// read races the migration on first launch after upgrade.
const LEGACY_REPORTS_KEY = "reports";

function reportStorageKey(username: string): string {
  return `${REPORT_KEY_PREFIX}${username}`;
}

export class ExtensionStorage implements StorageAdapter {
  async readReports(): Promise<Record<string, Report>> {
    const raw = (await browser.storage.local.get(null)) as Record<
      string,
      unknown
    >;
    const out: Record<string, Report> = {};

    // Fold the legacy blob first so a live per-key entry wins on overlap.
    const legacy = raw[LEGACY_REPORTS_KEY];
    if (legacy && typeof legacy === "object") {
      for (const [username, value] of Object.entries(legacy)) {
        out[username] = normalizeReport(value);
      }
    }

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith(REPORT_KEY_PREFIX)) {
        out[key.slice(REPORT_KEY_PREFIX.length)] = normalizeReport(value);
      }
    }

    return out;
  }

  async readReportSummaries(): Promise<Record<string, Report>> {
    const reports = await this.readReports();
    const out: Record<string, Report> = {};

    for (const [username, report] of Object.entries(reports)) {
      out[username] = slimReport(report);
    }

    return out;
  }

  // Bulk replace — the danger-zone path (see updateReport). Sets every
  // provided record under its own key in one call (one onChanged) and
  // removes any per-key records no longer in the map.
  async writeReports(reports: Record<string, Report>): Promise<void> {
    const raw = (await browser.storage.local.get(null)) as Record<
      string,
      unknown
    >;

    const batch: Record<string, Report> = {};

    for (const [username, report] of Object.entries(reports)) {
      batch[reportStorageKey(username)] = report;
    }

    const stale: string[] = [];

    for (const key of Object.keys(raw)) {
      if (key.startsWith(REPORT_KEY_PREFIX) && !(key in batch)) {
        stale.push(key);
      }
    }

    if (Object.keys(batch).length > 0) {
      await browser.storage.local.set(batch);
    }

    if (stale.length > 0) {
      await browser.storage.local.remove(stale);
    }
  }

  // Tail of the per-username update chain. Each updateReport call appends a
  // task to the entry's promise and replaces the entry with the new tail.
  // Map entry is evicted when its tail resolves and no further work has
  // been queued on top of it.
  private reportUpdateChains = new Map<string, Promise<unknown>>();

  async readReport(username: string): Promise<Report | null> {
    const directKey = reportStorageKey(username);
    const direct = await browser.storage.local.get(directKey);
    if (direct[directKey] !== undefined) {
      return normalizeReport(direct[directKey]);
    }

    // Case-mismatched key or a legacy-only record — fall back to a full
    // assemble so the case-insensitive lookup still resolves.
    const reports = await this.readReports();
    const key = findReportKey(reports, username);
    return key ? reports[key] : null;
  }

  async updateReport(username: string, updater: ReportUpdater): Promise<void> {
    const lockKey = username.toLowerCase();
    const previous = this.reportUpdateChains.get(lockKey) ?? Promise.resolve();

    // Swallow upstream errors for the *chain*: a prior caller's failure
    // shouldn't poison subsequent updates. The original caller already
    // received its own rejection via its own `await next` below.
    const next = previous
      .catch(() => undefined)
      .then(() => this.applyReportUpdate(username, updater));

    this.reportUpdateChains.set(lockKey, next);

    try {
      await next;
    } finally {
      if (this.reportUpdateChains.get(lockKey) === next) {
        this.reportUpdateChains.delete(lockKey);
      }
    }
  }

  private async applyReportUpdate(
    username: string,
    updater: ReportUpdater
  ): Promise<void> {
    const directKey = reportStorageKey(username);
    const direct = await browser.storage.local.get(directKey);

    let existingKey = username;
    let current: Report | null = null;
    let existed = false;

    if (direct[directKey] !== undefined) {
      current = normalizeReport(direct[directKey]);
      existed = true;
    } else {
      // A case-mismatched or legacy-blob record won't sit at the direct key —
      // fall back to a full assemble so the case-insensitive update still
      // resolves. The common path (exact lowercase key) never reaches here, so
      // the per-write cost no longer scales with the size of the whole store.
      const reports = await this.readReports();
      const key = findReportKey(reports, username);
      if (key) {
        existingKey = key;
        current = reports[key];
        existed = true;
      }
    }

    const updated = await updater(current);

    if (updated === null) {
      if (existed) {
        await browser.storage.local.remove(reportStorageKey(existingKey));
      }

      return;
    }

    if (updated === current) {
      return;
    }

    await browser.storage.local.set({
      [reportStorageKey(existingKey)]: updated,
    });
  }

  async readSubreddits(): Promise<Record<string, SubredditReport>> {
    const raw = (await browser.storage.local.get("subreddits")) as {
      subreddits?: Record<string, unknown>;
    };
    const out: Record<string, SubredditReport> = {};

    for (const [name, value] of Object.entries(raw.subreddits ?? {})) {
      const normalized = normalizeSubredditReport(name, value);
      if (normalized) {
        out[name] = normalized;
      }
    }

    return out;
  }

  async writeSubreddits(
    subreddits: Record<string, SubredditReport>
  ): Promise<void> {
    await browser.storage.local.set({ subreddits });
  }

  async readApiKey(vendor: LlmVendor): Promise<string> {
    const map = await this.readAllApiKeys();
    return map[vendor] ?? "";
  }

  async readAllApiKeys(): Promise<ApiKeyMap> {
    const raw = (await browser.storage.local.get("apiKeys")) as {
      apiKeys?: unknown;
    };

    if (!raw.apiKeys || typeof raw.apiKeys !== "object") {
      return {};
    }

    const out: ApiKeyMap = {};
    const entries = raw.apiKeys as Record<string, unknown>;

    for (const [vendor, value] of Object.entries(entries)) {
      if (typeof value === "string" && value) {
        out[vendor as LlmVendor] = value;
      }
    }

    return out;
  }

  async writeApiKey(vendor: LlmVendor, key: string): Promise<void> {
    const map = await this.readAllApiKeys();
    map[vendor] = key;
    await browser.storage.local.set({ apiKeys: map });
  }

  async clearAllApiKeys(): Promise<void> {
    await browser.storage.local.remove("apiKeys");
  }

  async readLlmSelection(): Promise<LlmSelection> {
    const raw = (await browser.storage.local.get([
      "llmVendor",
      "llmModel",
    ])) as { llmVendor?: unknown; llmModel?: unknown };

    return {
      vendor:
        typeof raw.llmVendor === "string" ? (raw.llmVendor as LlmVendor) : null,
      model: typeof raw.llmModel === "string" ? raw.llmModel : null,
    };
  }

  async readHidePii(): Promise<boolean> {
    const raw = (await browser.storage.local.get("hidePii")) as {
      hidePii?: unknown;
    };

    return raw.hidePii === true;
  }

  async writeHidePii(value: boolean): Promise<void> {
    if (value) {
      await browser.storage.local.set({ hidePii: true });
    } else {
      await browser.storage.local.remove("hidePii");
    }
  }

  async writeLlmSelection(selection: LlmSelection): Promise<void> {
    const toRemove: string[] = [];
    const toSet: Record<string, string> = {};

    if (selection.vendor) {
      toSet.llmVendor = selection.vendor;
    } else {
      toRemove.push("llmVendor");
    }

    if (selection.model) {
      toSet.llmModel = selection.model;
    } else {
      toRemove.push("llmModel");
    }

    if (Object.keys(toSet).length > 0) {
      await browser.storage.local.set(toSet);
    }

    if (toRemove.length > 0) {
      await browser.storage.local.remove(toRemove);
    }
  }

  async readRedditPauseUntil(): Promise<number | null> {
    const raw = (await browser.storage.local.get("redditPauseUntil")) as {
      redditPauseUntil?: number;
    };

    return typeof raw.redditPauseUntil === "number"
      ? raw.redditPauseUntil
      : null;
  }

  async writeRedditPauseUntil(value: number | null): Promise<void> {
    if (value === null) {
      await browser.storage.local.remove("redditPauseUntil");
    } else {
      await browser.storage.local.set({ redditPauseUntil: value });
    }
  }

  async readSyncConfig(): Promise<SyncConfig> {
    const raw = (await browser.storage.local.get("syncConfig")) as {
      syncConfig?: unknown;
    };

    return normalizeSyncConfig(raw.syncConfig);
  }

  async writeSyncConfig(config: SyncConfig): Promise<void> {
    await browser.storage.local.set({ syncConfig: config });
  }

  async readBlocklistCleanupState(): Promise<BlocklistCleanupState> {
    const raw = (await browser.storage.local.get("blocklistCleanup")) as {
      blocklistCleanup?: unknown;
    };

    return normalizeBlocklistCleanupState(raw.blocklistCleanup);
  }

  async writeBlocklistCleanupState(
    state: BlocklistCleanupState
  ): Promise<void> {
    await browser.storage.local.set({ blocklistCleanup: state });
  }
}

// Canonicalize a stored subreddit record. Drops entries that don't have a
// usable name or sampled-author list — those are the only fields the
// derived verdict reads, so a record missing them carries no signal.
function normalizeSubredditReport(
  key: string,
  value: unknown
): SubredditReport | null {
  const record = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;

  const name =
    typeof record.name === "string" && record.name ? record.name : key;
  const analyzedAt =
    typeof record.analyzedAt === "number" ? record.analyzedAt : 0;
  const sampledUsernames = Array.isArray(record.sampledUsernames)
    ? (record.sampledUsernames as unknown[])
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .map((u) => u.toLowerCase())
    : [];

  if (sampledUsernames.length === 0) {
    return null;
  }

  return { name, analyzedAt, sampledUsernames };
}

function normalizeBlocklistCleanupState(value: unknown): BlocklistCleanupState {
  const record = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;

  const probedAt: Record<string, number> = {};
  if (record.probedAt && typeof record.probedAt === "object") {
    for (const [username, at] of Object.entries(record.probedAt)) {
      if (typeof at === "number") {
        probedAt[username] = at;
      }
    }
  }

  const unblocked = Array.isArray(record.unblocked)
    ? (record.unblocked as unknown[]).filter(
        (entry): entry is { username: string; at: number } =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as { username?: unknown }).username === "string" &&
          typeof (entry as { at?: unknown }).at === "number"
      )
    : [];

  const sweep = (
    record.lastSweep && typeof record.lastSweep === "object"
      ? record.lastSweep
      : null
  ) as Record<string, unknown> | null;

  return {
    lastSweep:
      sweep && typeof sweep.at === "number"
        ? {
            at: sweep.at,
            blockedCount:
              typeof sweep.blockedCount === "number" ? sweep.blockedCount : 0,
            probedCount:
              typeof sweep.probedCount === "number" ? sweep.probedCount : 0,
            unblockedCount:
              typeof sweep.unblockedCount === "number"
                ? sweep.unblockedCount
                : 0,
          }
        : null,
    probedAt,
    unblocked,
  };
}

function normalizeSyncConfig(value: unknown): SyncConfig {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_SYNC_CONFIG };
  }

  const record = value as Record<string, unknown>;

  return {
    enabled: record.enabled === true,
    gistId: typeof record.gistId === "string" ? record.gistId : null,
    token: typeof record.token === "string" ? record.token : null,
    lastSyncedAt:
      typeof record.lastSyncedAt === "number" ? record.lastSyncedAt : null,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
  };
}
