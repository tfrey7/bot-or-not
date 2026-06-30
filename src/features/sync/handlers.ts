// Background-context handlers for the sync feature. Reads/writes the
// `reports` storage key only — the Claude API key is intentionally
// excluded from backups and never round-tripped through this code path.

import type { Report } from "../../types.ts";
import { readReports, writeReports } from "../../storage";
import {
  syncBuildBackup,
  syncMergeReports,
  type MergeStats,
  type SyncBackupPayload,
} from "./logic.ts";

export async function syncExport(): Promise<{ payload: SyncBackupPayload }> {
  const reports = await readReports();
  const appVersion = browser.runtime.getManifest().version;

  return {
    payload: syncBuildBackup({ reports, appVersion }),
  };
}

interface ImportRequest {
  reports: Record<string, Report>;
}

export async function syncImport(
  request: ImportRequest
): Promise<{ ok: true; stats: MergeStats }> {
  const local = await readReports();
  const { reports, stats } = syncMergeReports(local, request.reports);
  await writeReports(reports);

  return { ok: true, stats };
}
