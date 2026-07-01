// Background-context handlers for the sync feature — manual export/import
// plus the automatic-sync configuration surface. Reports and the SyncConfig
// are the only storage this touches; the Claude API key is intentionally
// excluded from backups and the GitHub token never leaves the SyncConfig.

import type { Report } from "../../types.ts";
import {
  readReports,
  readSyncConfig,
  writeReports,
  writeSyncConfig,
} from "../../storage";
import {
  syncBuildBackup,
  syncMergeReports,
  type MergeStats,
  type SyncBackupPayload,
  type SyncStatusPayload,
} from "./logic.ts";
import { createSyncGist } from "./remote.ts";
import { runReconcile, syncSetupAlarm } from "./schedule.ts";

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

async function buildStatus(): Promise<SyncStatusPayload> {
  const config = await readSyncConfig();

  return {
    enabled: config.enabled,
    gistId: config.gistId,
    hasToken: !!config.token,
    lastSyncedAt: config.lastSyncedAt,
    lastError: config.lastError,
  };
}

export function syncStatus(): Promise<SyncStatusPayload> {
  return buildStatus();
}

// Creates a fresh private gist and enables sync against it. A bad token
// surfaces here (createSyncGist throws) — that's the boundary we want the UI
// to show; the first reconcile's error is captured on the config instead.
export async function syncCreateGist(request: {
  token: string;
}): Promise<SyncStatusPayload> {
  const gistId = await createSyncGist(request.token);
  const current = await readSyncConfig();

  await writeSyncConfig({
    ...current,
    enabled: true,
    gistId,
    token: request.token,
    lastError: null,
  });
  await syncSetupAlarm();

  try {
    await runReconcile("create-gist");
  } catch {
    // Recorded on the config's lastError by syncReconcile.
  }

  return buildStatus();
}

interface ConfigureRequest {
  token: string;
  gistId: string;
  enabled: boolean;
}

export async function syncConfigure(
  request: ConfigureRequest
): Promise<SyncStatusPayload> {
  const current = await readSyncConfig();

  await writeSyncConfig({
    ...current,
    enabled: request.enabled,
    gistId: request.gistId,
    token: request.token,
    lastError: null,
  });
  await syncSetupAlarm();

  if (request.enabled) {
    try {
      await runReconcile("configure");
    } catch {
      // Recorded on the config's lastError by syncReconcile.
    }
  }

  return buildStatus();
}

export async function syncNow(): Promise<SyncStatusPayload> {
  try {
    await runReconcile("manual");
  } catch {
    // Recorded on the config's lastError by syncReconcile.
  }

  return buildStatus();
}

export async function syncDisable(): Promise<SyncStatusPayload> {
  const current = await readSyncConfig();
  await writeSyncConfig({ ...current, enabled: false });
  await syncSetupAlarm();

  return buildStatus();
}
