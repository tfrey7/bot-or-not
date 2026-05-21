// Pure aggregations for the diagnostics tab. Takes the raw reports map
// from background storage and produces a flat summary the widgets can
// paint without any further math.

import type { Report, Verdict } from "../../types.ts";

export interface DiagnosticsSummary {
  totalRecords: number;
  estimatedBytes: number;
  apiKeySet: boolean;

  oldestReportedAt: number | null;
  newestReportedAt: number | null;

  investigated: number;
  investigationQueued: number;
  investigationRunning: number;
  investigationDone: number;
  investigationError: number;
  totalRuns: number;

  queueRunning: QueueEntry[];
  queueQueued: QueueEntry[];

  botBouncerBanned: number;
  botBouncerPending: number;
  botBouncerOrganic: number;
  botBouncerUnknown: number;

  userActive: number;
  userSuspended: number;
  userUnknown: number;

  withRing: number;
  distinctRings: number;
  withActivity: number;
  withHistory: number;

  verdictCounts: Record<Verdict, number>;

  recentErrors: ErrorRow[];
}

export interface ErrorRow {
  username: string;
  message: string;
  runAt: number | null;
}

// `since` is investigation.startedAt for running entries, queuedAt for queued
// ones. Caller sorts/labels accordingly.
export interface QueueEntry {
  username: string;
  since: number | null;
}

export function bonDiagnosticsSummarize(
  reports: Record<string, Report>,
  apiKeySet: boolean
): DiagnosticsSummary {
  const summary: DiagnosticsSummary = {
    totalRecords: 0,
    estimatedBytes: utf8ByteSize(reports),
    apiKeySet,
    oldestReportedAt: null,
    newestReportedAt: null,
    investigated: 0,
    investigationQueued: 0,
    investigationRunning: 0,
    investigationDone: 0,
    investigationError: 0,
    totalRuns: 0,
    queueRunning: [],
    queueQueued: [],
    botBouncerBanned: 0,
    botBouncerPending: 0,
    botBouncerOrganic: 0,
    botBouncerUnknown: 0,
    userActive: 0,
    userSuspended: 0,
    userUnknown: 0,
    withRing: 0,
    distinctRings: 0,
    withActivity: 0,
    withHistory: 0,
    verdictCounts: {
      bot: 0,
      "likely-bot": 0,
      uncertain: 0,
      "likely-human": 0,
      human: 0,
    },
    recentErrors: [],
  };

  const rings = new Set<string>();
  const errors: ErrorRow[] = [];

  for (const [username, report] of Object.entries(reports)) {
    summary.totalRecords += 1;

    if (report.lastReportedAt) {
      if (
        summary.oldestReportedAt === null ||
        report.lastReportedAt < summary.oldestReportedAt
      ) {
        summary.oldestReportedAt = report.lastReportedAt;
      }

      if (
        summary.newestReportedAt === null ||
        report.lastReportedAt > summary.newestReportedAt
      ) {
        summary.newestReportedAt = report.lastReportedAt;
      }
    }

    const investigation = report.investigation;
    if (investigation) {
      summary.investigated += 1;
      if (investigation.status === "queued") {
        summary.investigationQueued += 1;
        summary.queueQueued.push({
          username,
          since: investigation.queuedAt,
        });
      } else if (investigation.status === "running") {
        summary.investigationRunning += 1;
        summary.queueRunning.push({
          username,
          since: investigation.startedAt,
        });
      } else if (investigation.status === "done") {
        summary.investigationDone += 1;
        summary.verdictCounts[investigation.results.verdict] += 1;
      } else if (investigation.status === "error") {
        summary.investigationError += 1;
        errors.push({
          username,
          message: investigation.error || "unknown error",
          runAt: null,
        });
      }

      summary.totalRuns += investigation.runs.length;
    }

    if (report.botBouncerStatus === "banned") {
      summary.botBouncerBanned += 1;
    } else if (report.botBouncerStatus === "pending") {
      summary.botBouncerPending += 1;
    } else if (report.botBouncerStatus === "organic") {
      summary.botBouncerOrganic += 1;
    } else {
      summary.botBouncerUnknown += 1;
    }

    if (report.userStatus === "active") {
      summary.userActive += 1;
    } else if (report.userStatus === "suspended") {
      summary.userSuspended += 1;
    } else {
      summary.userUnknown += 1;
    }

    if (report.ringId) {
      summary.withRing += 1;
      rings.add(report.ringId);
    }

    if (report.activityData) {
      summary.withActivity += 1;
    }

    if (report.history.length > 0) {
      summary.withHistory += 1;
    }
  }

  summary.distinctRings = rings.size;

  errors.sort((a, b) => (b.runAt ?? 0) - (a.runAt ?? 0));
  summary.recentErrors = errors.slice(0, 10);

  summary.queueRunning.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
  summary.queueQueued.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));

  return summary;
}

// Rough UTF-8 byte estimate. Browser storage is JSON-serialized under the
// hood, so JSON.stringify length is close enough for a "how much space am I
// using" tile. Avoids needing browser.storage.local.getBytesInUse (not
// uniformly supported across versions).
function utf8ByteSize(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (!json) {
      return 0;
    }

    return new Blob([json]).size;
  } catch {
    return 0;
  }
}

export function bonDiagnosticsFormatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
