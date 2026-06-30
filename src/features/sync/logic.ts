// Pure logic for the sync feature — build the export payload, parse + validate
// an import payload, merge incoming reports into existing storage per-username.

import type { Report } from "../../types.ts";
import {
  dedupeHistory,
  investigationResults,
  normalizeReport,
} from "../../utils/history.ts";

export const SYNC_BACKUP_VERSION = 1;

export interface SyncBackupPayload {
  bonBackup: number;
  exportedAt: number;
  appVersion: string;
  reports: Record<string, Report>;
}

export interface BuildBackupOptions {
  reports: Record<string, Report>;
  appVersion: string;
}

export function syncBuildBackup({
  reports,
  appVersion,
}: BuildBackupOptions): SyncBackupPayload {
  return {
    bonBackup: SYNC_BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion,
    reports,
  };
}

export function syncBackupFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `bot-or-not-backup-${yyyy}${mm}${dd}-${hh}${min}.json`;
}

export type ParseResult =
  { ok: true; payload: SyncBackupPayload } | { ok: false; error: string };

export function syncParseBackup(raw: string): ParseResult {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `Not valid JSON: ${(error as Error).message}`,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      ok: false,
      error: "Not a Bot or Not backup (expected an object).",
    };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.bonBackup !== "number") {
    return {
      ok: false,
      error: "Not a Bot or Not backup (missing bonBackup marker).",
    };
  }

  if (record.bonBackup > SYNC_BACKUP_VERSION) {
    return {
      ok: false,
      error: `Backup is from a newer version (v${record.bonBackup}). Upgrade Bot or Not first.`,
    };
  }

  const rawReports = record.reports;
  if (!rawReports || typeof rawReports !== "object") {
    return { ok: false, error: "Backup is missing the reports field." };
  }

  const reports: Record<string, Report> = {};

  for (const [username, value] of Object.entries(
    rawReports as Record<string, unknown>
  )) {
    reports[username] = normalizeReport(value);
  }

  return {
    ok: true,
    payload: {
      bonBackup: record.bonBackup,
      exportedAt: typeof record.exportedAt === "number" ? record.exportedAt : 0,
      appVersion:
        typeof record.appVersion === "string" ? record.appVersion : "unknown",
      reports,
    },
  };
}

export interface MergeStats {
  added: string[];
  merged: string[];
  unchanged: string[];
}

export interface MergeResult {
  reports: Record<string, Report>;
  stats: MergeStats;
}

// Per-username merge: incoming records combine with local ones field-by-field,
// preferring the newer timestamps for status updates and the newer investigation
// for verdict/persona. History entries dedupe by permalink. Ring membership
// stays whatever the local record had — ringIds are opaque local identifiers
// and re-linking is a one-click operation if needed.
export function syncMergeReports(
  local: Record<string, Report>,
  incoming: Record<string, Report>
): MergeResult {
  const result: Record<string, Report> = { ...local };
  const stats: MergeStats = { added: [], merged: [], unchanged: [] };

  for (const [username, incomingReport] of Object.entries(incoming)) {
    const localKey = findCaseInsensitiveKey(result, username);

    if (!localKey) {
      result[username] = incomingReport;
      stats.added.push(username);
      continue;
    }

    const localReport = result[localKey];
    const merged = mergeOneReport(localReport, incomingReport);
    result[localKey] = merged;

    if (reportsEquivalent(localReport, merged)) {
      stats.unchanged.push(localKey);
    } else {
      stats.merged.push(localKey);
    }
  }

  return { reports: result, stats };
}

function findCaseInsensitiveKey(
  reports: Record<string, Report>,
  username: string
): string | null {
  if (reports[username]) {
    return username;
  }

  const target = username.toLowerCase();

  for (const key of Object.keys(reports)) {
    if (key.toLowerCase() === target) {
      return key;
    }
  }

  return null;
}

// Returns Required<Report> so adding a new field to Report — even an optional
// one — forces a typecheck error here until a merge rule is chosen for it.
function mergeOneReport(local: Report, incoming: Report): Required<Report> {
  const history = dedupeHistory([...local.history, ...incoming.history]);

  const localStatusAt = local.userStatusCheckedAt;
  const incomingStatusAt = incoming.userStatusCheckedAt;
  const useIncomingStatus = incomingStatusAt > localStatusAt;

  const localBouncerAt = local.botBouncerCheckedAt;
  const incomingBouncerAt = incoming.botBouncerCheckedAt;
  const useIncomingBouncer = incomingBouncerAt > localBouncerAt;

  const localRunAt = investigationResults(local.investigation)?.runAt ?? 0;
  const incomingRunAt =
    investigationResults(incoming.investigation)?.runAt ?? 0;
  const useIncomingInvestigation = incomingRunAt > localRunAt;

  const localNotesAt = local.userNotes?.updatedAt ?? 0;
  const incomingNotesAt = incoming.userNotes?.updatedAt ?? 0;
  const useIncomingNotes = incomingNotesAt > localNotesAt;

  const localHarvestAt = local.googleHarvest?.lastCapturedAt ?? 0;
  const incomingHarvestAt = incoming.googleHarvest?.lastCapturedAt ?? 0;
  const useIncomingHarvest = incomingHarvestAt > localHarvestAt;

  const localPassiveAt = local.passiveHarvest?.lastSeenAt ?? 0;
  const incomingPassiveAt = incoming.passiveHarvest?.lastSeenAt ?? 0;
  const useIncomingPassive = incomingPassiveAt > localPassiveAt;

  return {
    count: history.length,
    lastReportedAt: Math.max(local.lastReportedAt, incoming.lastReportedAt),
    history,
    userStatus: useIncomingStatus ? incoming.userStatus : local.userStatus,
    userStatusCheckedAt: Math.max(localStatusAt, incomingStatusAt),
    createdAt: local.createdAt ?? incoming.createdAt,
    totalKarma: useIncomingInvestigation
      ? (incoming.totalKarma ?? local.totalKarma)
      : (local.totalKarma ?? incoming.totalKarma),
    botBouncerStatus: useIncomingBouncer
      ? incoming.botBouncerStatus
      : local.botBouncerStatus,
    botBouncerCheckedAt: Math.max(localBouncerAt, incomingBouncerAt),
    investigation: useIncomingInvestigation
      ? incoming.investigation
      : local.investigation,
    activityData: useIncomingInvestigation
      ? (incoming.activityData ?? local.activityData)
      : (local.activityData ?? incoming.activityData),
    ringId: local.ringId ?? incoming.ringId,
    userNotes: useIncomingNotes ? incoming.userNotes : local.userNotes,
    googleHarvest: useIncomingHarvest
      ? incoming.googleHarvest
      : local.googleHarvest,
    profileHidden: useIncomingInvestigation
      ? incoming.profileHidden
      : local.profileHidden,
    passiveHarvest: useIncomingPassive
      ? incoming.passiveHarvest
      : local.passiveHarvest,
  };
}

function reportsEquivalent(a: Report, b: Report): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
