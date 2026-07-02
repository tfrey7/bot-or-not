// StorageAdapter backing outside the extension — CLI scripts and tests, where
// `browser.storage.local` doesn't exist. State lives only for the process
// lifetime, which is all a one-shot script run needs.

import type { LlmVendor } from "../llm/index.ts";
import type { Report, SubredditReport } from "../types.ts";
import { findReportKey } from "../utils/history.ts";
import { slimReport } from "./logic.ts";
import type {
  ApiKeyMap,
  BlocklistCleanupState,
  LlmSelection,
  ReportUpdater,
  StorageAdapter,
  SyncConfig,
} from "./types.ts";

export class InMemoryStorage implements StorageAdapter {
  private reports: Record<string, Report> = {};
  private subreddits: Record<string, SubredditReport> = {};
  private apiKeys: ApiKeyMap = {};
  private llmSelection: LlmSelection = { vendor: null, model: null };
  private hidePii = false;
  private redditPauseUntil: number | null = null;
  private syncConfig: SyncConfig = {
    enabled: false,
    gistId: null,
    token: null,
    lastSyncedAt: null,
    lastError: null,
  };
  private blocklistCleanup: BlocklistCleanupState = {
    lastSweep: null,
    probedAt: {},
    unblocked: [],
  };

  async readReports(): Promise<Record<string, Report>> {
    return { ...this.reports };
  }

  async readReportSummaries(): Promise<Record<string, Report>> {
    const out: Record<string, Report> = {};

    for (const [username, report] of Object.entries(this.reports)) {
      out[username] = slimReport(report);
    }

    return out;
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

  async readSyncConfig(): Promise<SyncConfig> {
    return { ...this.syncConfig };
  }

  async writeSyncConfig(config: SyncConfig): Promise<void> {
    this.syncConfig = { ...config };
  }

  async readBlocklistCleanupState(): Promise<BlocklistCleanupState> {
    return { ...this.blocklistCleanup };
  }

  async writeBlocklistCleanupState(
    state: BlocklistCleanupState
  ): Promise<void> {
    this.blocklistCleanup = { ...state };
  }
}
