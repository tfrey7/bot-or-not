// Storage adapter — the single seam between application code and whatever
// backs persistence underneath. Today that's `browser.storage.local`; the
// same interface could be implemented against a server's HTTP API to host
// the same code as a website with a real backend.
//
// All sanctioned reads/writes go through the module-level functions below.
// `storage` is the live implementation; swapping it for a different class
// is the only change needed to retarget the backend.

import type { LlmVendor } from "./llm/index.ts";
import type { Report, SubredditReport } from "./types.ts";
import { findReportKey, normalizeReport } from "./utils/history.ts";

// Persisted LLM selection. Both fields nullable — `null` means "use the
// provider's built-in default," so a fresh install (and any user who's
// never opened the settings tab) behaves exactly like before.
export interface LlmSelection {
  vendor: LlmVendor | null;
  model: string | null;
}

// One key per vendor. Missing entries = no key on file for that vendor.
export type ApiKeyMap = Partial<Record<LlmVendor, string>>;

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

// Updater for updateReport. Receives the current Report (or null if no
// record exists for this username) and returns the next one. Return null to
// delete the record; return the current value untouched to no-op the write.
export type ReportUpdater = (
  current: Report | null
) => Report | null | Promise<Report | null>;

interface StorageAdapter {
  readReports(): Promise<Record<string, Report>>;
  writeReports(reports: Record<string, Report>): Promise<void>;

  // Single-record read. Case-insensitive on username to match the way the
  // report map is keyed in practice (lowercase going forward, mixed-case
  // legacy data still on disk).
  readReport(username: string): Promise<Report | null>;

  // Atomically updates one record under a per-username lock. Concurrent
  // calls for the same username run strictly in order; calls for different
  // usernames run independently. Bulk writers via writeReports() are not
  // coordinated with this lock — they remain the danger-zone path.
  updateReport(username: string, updater: ReportUpdater): Promise<void>;

  readSubreddits(): Promise<Record<string, SubredditReport>>;
  writeSubreddits(subreddits: Record<string, SubredditReport>): Promise<void>;

  readApiKey(vendor: LlmVendor): Promise<string>;
  readAllApiKeys(): Promise<ApiKeyMap>;
  writeApiKey(vendor: LlmVendor, key: string): Promise<void>;
  clearAllApiKeys(): Promise<void>;

  readLlmSelection(): Promise<LlmSelection>;
  writeLlmSelection(selection: LlmSelection): Promise<void>;

  readHidePii(): Promise<boolean>;
  writeHidePii(value: boolean): Promise<void>;

  // Cross-tab Reddit rate-limit pause. `null` means "not paused"; a number
  // is the epoch-ms instant fetches may resume. Persisted so UI surfaces can
  // show a banner via storage.onChanged and so a reloaded worker restores it.
  readRedditPauseUntil(): Promise<number | null>;
  writeRedditPauseUntil(value: number | null): Promise<void>;
}

class ExtensionStorage implements StorageAdapter {
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
    const reports = await this.readReports();
    const existingKey = findReportKey(reports, username) ?? username;
    const current = reports[existingKey] ?? null;
    const updated = await updater(current);

    if (updated === null) {
      if (existingKey in reports) {
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
}

// Backs the adapter outside the extension — CLI scripts and tests, where
// `browser.storage.local` doesn't exist. State lives only for the process
// lifetime, which is all a one-shot script run needs.
class InMemoryStorage implements StorageAdapter {
  private reports: Record<string, Report> = {};
  private subreddits: Record<string, SubredditReport> = {};
  private apiKeys: ApiKeyMap = {};
  private llmSelection: LlmSelection = { vendor: null, model: null };
  private hidePii = false;
  private redditPauseUntil: number | null = null;

  async readReports(): Promise<Record<string, Report>> {
    return { ...this.reports };
  }

  async writeReports(reports: Record<string, Report>): Promise<void> {
    this.reports = { ...reports };
  }

  async readReport(username: string): Promise<Report | null> {
    const key = findReportKey(this.reports, username);
    return key ? this.reports[key] : null;
  }

  async updateReport(username: string, updater: ReportUpdater): Promise<void> {
    const existingKey = findReportKey(this.reports, username) ?? username;
    const current = this.reports[existingKey] ?? null;
    const updated = await updater(current);

    if (updated === null) {
      delete this.reports[existingKey];
      return;
    }

    this.reports[existingKey] = updated;
  }

  async readSubreddits(): Promise<Record<string, SubredditReport>> {
    return { ...this.subreddits };
  }

  async writeSubreddits(
    subreddits: Record<string, SubredditReport>
  ): Promise<void> {
    this.subreddits = { ...subreddits };
  }

  async readApiKey(vendor: LlmVendor): Promise<string> {
    return this.apiKeys[vendor] ?? "";
  }

  async readAllApiKeys(): Promise<ApiKeyMap> {
    return { ...this.apiKeys };
  }

  async writeApiKey(vendor: LlmVendor, key: string): Promise<void> {
    this.apiKeys[vendor] = key;
  }

  async clearAllApiKeys(): Promise<void> {
    this.apiKeys = {};
  }

  async readLlmSelection(): Promise<LlmSelection> {
    return { ...this.llmSelection };
  }

  async writeLlmSelection(selection: LlmSelection): Promise<void> {
    this.llmSelection = { ...selection };
  }

  async readHidePii(): Promise<boolean> {
    return this.hidePii;
  }

  async writeHidePii(value: boolean): Promise<void> {
    this.hidePii = value;
  }

  async readRedditPauseUntil(): Promise<number | null> {
    return this.redditPauseUntil;
  }

  async writeRedditPauseUntil(value: number | null): Promise<void> {
    this.redditPauseUntil = value;
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

// Scripts and tests import this module without a `browser` global; fall back
// to in-memory there so the seam works the same everywhere.
const storage: StorageAdapter =
  typeof browser === "undefined"
    ? new InMemoryStorage()
    : new ExtensionStorage();

// Module-level function wrappers — the public API everywhere else in the
// codebase consumes. Function-style is consistent with the rest of the
// project's exports and keeps callsites stable if the singleton ever
// becomes injected.

export function readReports(): Promise<Record<string, Report>> {
  return storage.readReports();
}

export function writeReports(reports: Record<string, Report>): Promise<void> {
  return storage.writeReports(reports);
}

export function readReport(username: string): Promise<Report | null> {
  return storage.readReport(username);
}

export function updateReport(
  username: string,
  updater: ReportUpdater
): Promise<void> {
  return storage.updateReport(username, updater);
}

export function readSubreddits(): Promise<Record<string, SubredditReport>> {
  return storage.readSubreddits();
}

export function writeSubreddits(
  subreddits: Record<string, SubredditReport>
): Promise<void> {
  return storage.writeSubreddits(subreddits);
}

export function readApiKey(vendor: LlmVendor): Promise<string> {
  return storage.readApiKey(vendor);
}

export function readAllApiKeys(): Promise<ApiKeyMap> {
  return storage.readAllApiKeys();
}

export function writeApiKey(vendor: LlmVendor, key: string): Promise<void> {
  return storage.writeApiKey(vendor, key);
}

export function clearAllApiKeys(): Promise<void> {
  return storage.clearAllApiKeys();
}

export function readLlmSelection(): Promise<LlmSelection> {
  return storage.readLlmSelection();
}

export function writeLlmSelection(selection: LlmSelection): Promise<void> {
  return storage.writeLlmSelection(selection);
}

export function readHidePii(): Promise<boolean> {
  return storage.readHidePii();
}

export function writeHidePii(value: boolean): Promise<void> {
  return storage.writeHidePii(value);
}

export function readRedditPauseUntil(): Promise<number | null> {
  return storage.readRedditPauseUntil();
}

export function writeRedditPauseUntil(value: number | null): Promise<void> {
  return storage.writeRedditPauseUntil(value);
}
