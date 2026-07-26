// The storage seam — the single interface between application code and
// whatever backs persistence underneath. Today that's `browser.storage.local`
// (see extension.ts); the same interface could be implemented against a
// server's HTTP API to host the same code as a website with a real backend.

import type { LlmVendor } from "../llm/index.ts";
import type { RedditTelemetryState } from "../reddit/telemetry.ts";
import type { AccountKarma, Report, SubredditReport } from "../types.ts";

// Persisted LLM selection. Both fields nullable — `null` means "use the
// provider's built-in default," so a fresh install (and any user who's
// never opened the settings tab) behaves exactly like before.
export interface LlmSelection {
  vendor: LlmVendor | null;
  model: string | null;
}

// One key per vendor. Missing entries = no key on file for that vendor.
export type ApiKeyMap = Partial<Record<LlmVendor, string>>;

// Automatic-sync settings. `token` is a GitHub PAT — a secret held only in
// local storage, never written into the synced gist payload (same rule as
// the LLM API keys). A fresh install has enabled=false and no gist/token.
export interface SyncConfig {
  enabled: boolean;
  gistId: string | null;
  token: string | null;
  lastSyncedAt: number | null;
  lastError: string | null;
}

// Blocklist-cleanup sweep bookkeeping. `lastSweep` summarizes the most
// recent pass (null before the first one), doubles as the daily gate, and is
// updated in place as the sweep progresses so a worker death leaves a
// visible partial record. `history` keeps completed summaries so trends
// (pressure, probe backlog, eviction pipeline depth) are visible over time.
// `probes` holds the per-account liveness/karma trail for every blocked
// account, keyed by lowercase username and pruned to the current block list
// each sweep. `unblocked` is the audit trail of accounts the sweep removed
// from the operator's block list; `watchlist` are the ones we still watch
// for a return to activity (see the tripwire), with the karma snapshot from
// eviction time as the activity baseline; `reblocked` is the audit trail of
// watchlisted accounts that came back and were re-blocked.
export interface BlocklistSweepSummary {
  at: number;
  blockedCount: number;
  probeBudget: number;
  dueCount: number;
  probedCount: number;
  aliveCount: number;
  unblockedDead: number;
  unblockedDormant: number;

  // Older stored summaries predate this field.
  unblockedLowKarma?: number;
  trackedCount: number;
  matureCount: number;
}

// `stableSince` is when the current karma value was first observed — the
// span up to `at` is how long the account has provably produced nothing.
export interface BlocklistProbe {
  at: number;
  karma: AccountKarma | null;
  stableSince: number;
}

export interface BlocklistWatchEntry {
  at: number;
  karma: AccountKarma | null;
}

export interface BlocklistCleanupState {
  lastSweep: BlocklistSweepSummary | null;
  history: BlocklistSweepSummary[];
  probes: Record<string, BlocklistProbe>;
  unblocked: Array<{
    username: string;
    at: number;
    reason: "dead" | "dormant" | "low-karma";
  }>;
  watchlist: Record<string, BlocklistWatchEntry>;
  reblocked: Array<{ username: string; at: number }>;
}

// Pass-level bookkeeping for the weekly status re-check sweep. `lastSweepAt`
// doubles as the gate that keeps frequent background wakes from firing a
// probe batch each time; `lastProbed` is how many accounts the last pass hit.
export interface StatusRecheckState {
  lastSweepAt: number | null;
  lastProbed: number;
}

// Updater for updateReport. Receives the current Report (or null if no
// record exists for this username) and returns the next one. Return null to
// delete the record; return the current value untouched to no-op the write.
export type ReportUpdater = (
  current: Report | null
) => Report | null | Promise<Report | null>;

// Mutator for updateReports. Receives the full current map and returns the
// desired full map — records absent from the result are deleted. Return null
// to no-op without writing. Runs inside the report mutation lock, so keep it
// fast and pure: do network work before calling updateReports, not inside.
export type ReportsMutator = (
  current: Record<string, Report>
) => Record<string, Report> | null | Promise<Record<string, Report> | null>;

export interface StorageAdapter {
  readReports(): Promise<Record<string, Report>>;

  // Projection of every record with the heavy fields stripped — the shape
  // the reports-page list and its polling loop consume. A record's activity
  // dumps, history, harvest blobs, factor prose, and run snapshots are an
  // order of magnitude larger than the username/verdict/status the list
  // actually paints, so shipping them across the messaging boundary on every
  // load and every poll is what made the page sluggish at hundreds of records.
  // A server-backed adapter would implement this as a projected query.
  readReportSummaries(): Promise<Record<string, Report>>;

  // Bulk read-modify-write of the whole report map, serialized on the same
  // mutation lock as updateReport, so a bulk rewrite can never clobber or
  // delete records written concurrently by single-record updates.
  updateReports(mutator: ReportsMutator): Promise<void>;

  // Single-record read. Case-insensitive on username to match the way the
  // report map is keyed in practice (lowercase going forward, mixed-case
  // legacy data still on disk).
  readReport(username: string): Promise<Report | null>;

  // Atomically updates one record. All report mutations share one lock and
  // run strictly in order.
  updateReport(username: string, updater: ReportUpdater): Promise<void>;

  readSubreddits(): Promise<Record<string, SubredditReport>>;
  writeSubreddits(subreddits: Record<string, SubredditReport>): Promise<void>;

  readApiKey(vendor: LlmVendor): Promise<string>;
  readAllApiKeys(): Promise<ApiKeyMap>;
  writeApiKey(vendor: LlmVendor, key: string): Promise<void>;
  clearApiKey(vendor: LlmVendor): Promise<void>;
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

  readSyncConfig(): Promise<SyncConfig>;
  writeSyncConfig(config: SyncConfig): Promise<void>;

  readBlocklistCleanupState(): Promise<BlocklistCleanupState>;
  writeBlocklistCleanupState(state: BlocklistCleanupState): Promise<void>;

  readStatusRecheckState(): Promise<StatusRecheckState>;
  writeStatusRecheckState(state: StatusRecheckState): Promise<void>;

  readRedditTelemetry(): Promise<RedditTelemetryState>;
  writeRedditTelemetry(state: RedditTelemetryState): Promise<void>;

  // Operator kill switch for the background hygiene passes (status re-check,
  // blocklist cleanup, attribution drain). Investigations are unaffected.
  readMaintenancePaused(): Promise<boolean>;
  writeMaintenancePaused(value: boolean): Promise<void>;
}
