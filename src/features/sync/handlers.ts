// Background-context handlers for the sync feature. Reads/writes the
// `reports` storage key only — the Claude API key is intentionally
// excluded from backups and never round-tripped through this code path.

import type { Report } from "../../types.ts";
import { bonReadReports, bonWriteReports } from "../../utils/history.ts";
import {
  bonSyncBuildBackup,
  bonSyncMergeReports,
  type MergeStats,
  type SyncBackupPayload,
} from "./logic.ts";

export async function bonSyncExport(): Promise<{ payload: SyncBackupPayload }> {
  const reports = await bonReadReports();
  const appVersion = browser.runtime.getManifest().version;

  return {
    payload: bonSyncBuildBackup({ reports, appVersion }),
  };
}

export interface ImportRequest {
  reports: Record<string, Report>;
}

export async function bonSyncImport(
  request: ImportRequest
): Promise<{ ok: true; stats: MergeStats }> {
  const local = await bonReadReports();
  const { reports, stats } = bonSyncMergeReports(local, request.reports);
  await bonWriteReports(reports);

  return { ok: true, stats };
}
