// The storage seam — the single interface between application code and
// whatever backs persistence underneath. Today that's `browser.storage.local`
// (see extension.ts); the same interface could be implemented against a
// server's HTTP API to host the same code as a website with a real backend.

import type { LlmVendor } from "../llm/index.ts";
import type { Report, SubredditReport } from "../types.ts";

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

// Updater for updateReport. Receives the current Report (or null if no
// record exists for this username) and returns the next one. Return null to
// delete the record; return the current value untouched to no-op the write.
export type ReportUpdater = (
  current: Report | null
) => Report | null | Promise<Report | null>;

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

  readSyncConfig(): Promise<SyncConfig>;
  writeSyncConfig(config: SyncConfig): Promise<void>;
}
