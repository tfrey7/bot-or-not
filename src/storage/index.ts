// Public storage API. Every sanctioned read/write in the codebase goes
// through the module-level functions below; `storage` is the live adapter and
// swapping it (extension vs in-memory) is the only change needed to retarget
// the backend. The interface lives in types.ts, the implementations in
// extension.ts / memory.ts.

import type { LlmVendor } from "../llm/index.ts";
import type { Report, SubredditReport } from "../types.ts";
import { ExtensionStorage } from "./extension.ts";
import { InMemoryStorage } from "./memory.ts";
import type {
  ApiKeyMap,
  LlmSelection,
  ReportUpdater,
  StorageAdapter,
} from "./types.ts";

export type { ApiKeyMap, LlmSelection, ReportUpdater };

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

export function readReportSummaries(): Promise<Record<string, Report>> {
  return storage.readReportSummaries();
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
