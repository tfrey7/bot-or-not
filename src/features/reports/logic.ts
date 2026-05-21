// Pure transforms / helpers for the reports page table itself: active/queue
// ordering, running-row labels, structural-change detection, table sorting.
// No DOM, no I/O.
//
// Topic-specific helpers live in sibling files:
//   - `region.ts` for per-report region + timezone inference
//   - `subreddit_chart_data.ts` for the subreddit chart's bucket math

import type { Investigation, Report } from "../../types.ts";
import { bonExpectedDurationSec } from "../../utils/expected_duration.ts";
import { bonInvestigationResults } from "../../utils/history.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { BON_REPORTS_VERDICT_RANK } from "./data.ts";
import { bonReportsComputeRegionForReport } from "./region.ts";

export type ReportRow = Report & { username: string };

// Rows that belong above the divider — currently running or waiting in the
// queue. Everything else (done, errored, never investigated) sinks into the
// main list. Stale running counts as active until the sweeper rewrites it
// to "error"; that way an obviously-stuck row doesn't quietly disappear.
export function bonReportsIsActiveRow(report: ReportRow): boolean {
  const status = report.investigation?.status;
  return status === "running" || status === "queued";
}

// Sort order for the active table: running before queued, newest-started
// running first, oldest-queued first within the queue (FIFO matches the
// background's pickup order).
export function bonReportsCompareActive(a: ReportRow, b: ReportRow): number {
  const aStatus = a.investigation?.status;
  const bStatus = b.investigation?.status;

  if (aStatus === "running" && bStatus !== "running") {
    return -1;
  }

  if (bStatus === "running" && aStatus !== "running") {
    return 1;
  }

  if (aStatus === "running") {
    const aTime = a.investigation?.startedAt ?? 0;
    const bTime = b.investigation?.startedAt ?? 0;
    return bTime - aTime;
  }

  const aQueued = a.investigation?.queuedAt ?? 0;
  const bQueued = b.investigation?.queuedAt ?? 0;
  return aQueued - bQueued;
}

// Number of queued investigations ahead of `target` in the FIFO queue —
// older queuedAt values run first. Returns 0 if `target` isn't queued.
export function bonReportsCountQueuedAhead(
  reports: ReportRow[],
  target: ReportRow
): number {
  const myQueuedAt = target.investigation?.queuedAt;
  if (target.investigation?.status !== "queued" || myQueuedAt == null) {
    return 0;
  }

  let ahead = 0;

  for (const report of reports) {
    if (report.username === target.username) {
      continue;
    }

    const investigation = report.investigation;
    if (investigation?.status !== "queued") {
      continue;
    }

    if (investigation.queuedAt != null && investigation.queuedAt < myQueuedAt) {
      ahead++;
    }
  }

  return ahead;
}

export function bonReportsFormatRunningCellText(
  elapsedSec: number,
  expectedMs: number | null | undefined
): string {
  if (!expectedMs) {
    return `Running… ${elapsedSec}s`;
  }

  return `Running… ${elapsedSec}s / ~${bonExpectedDurationSec(expectedMs)}s`;
}

export function bonReportsFormatRunningTitle(
  elapsedSec: number,
  expectedMs: number | null | undefined
): string {
  if (!expectedMs) {
    return `Investigation running… ${elapsedSec}s elapsed (large accounts can take 60–90s)`;
  }

  const expSec = bonExpectedDurationSec(expectedMs);
  if (elapsedSec > expSec) {
    return `Running ${elapsedSec}s — longer than the typical ${expSec}s. Hang tight.`;
  }

  const remaining = Math.max(0, expSec - elapsedSec);
  return `Running ${elapsedSec}s · ~${remaining}s left (typical ${expSec}s)`;
}

export function bonReportsDiagnoseLoadError(
  message: string | null | undefined
): string {
  const normalized = (message || "").toLowerCase();

  if (
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection") ||
    normalized.includes("message port closed")
  ) {
    return "The extension background worker isn't responding. This usually happens after the extension was reloaded or updated while this page was open. Reload the page to reconnect.";
  }

  if (normalized.includes("quota") || normalized.includes("storage")) {
    return "Browser storage may be full or unavailable. Try clearing some reports or checking your browser's extension storage permissions.";
  }

  if (normalized.includes("undefined") || normalized.includes("cannot read")) {
    return "Stored report data may be corrupted. Check the browser console for details, or clear all reports from Settings as a last resort.";
  }

  return "Open the browser console (F12) for more details, then try reloading the page.";
}

export function bonReportsHasStructuralChange(
  prev: ReportRow[],
  next: ReportRow[]
): boolean {
  if (prev.length !== next.length) {
    return true;
  }

  const prevByUser = new Map(prev.map((report) => [report.username, report]));

  for (const report of next) {
    const prevReport = prevByUser.get(report.username);
    if (!prevReport) {
      return true;
    }

    const prevStatus = prevReport.investigation?.status;
    const nextStatus = report.investigation?.status;
    if (prevStatus !== nextStatus) {
      return true;
    }

    if (
      nextStatus === "queued" &&
      prevReport.investigation?.queuedAt !== report.investigation?.queuedAt
    ) {
      return true;
    }

    const prevVerdict =
      bonInvestigationResults(prevReport.investigation)?.verdict ?? null;
    const nextVerdict =
      bonInvestigationResults(report.investigation)?.verdict ?? null;

    if (prevVerdict !== nextVerdict) {
      return true;
    }

    if (prevReport.count !== report.count) {
      return true;
    }

    if (prevReport.lastReportedAt !== report.lastReportedAt) {
      return true;
    }

    const prevStale =
      prevStatus === "running" &&
      bonIsInvestigationStale(prevReport.investigation);
    const nextStale =
      nextStatus === "running" && bonIsInvestigationStale(report.investigation);

    if (prevStale !== nextStale) {
      return true;
    }
  }

  return false;
}

export type SortKey =
  | "username"
  | "count"
  | "verdict"
  | "investigatedAt"
  | "region";

export type SortDir = "asc" | "desc";

type SortValue = string | number | null;

export function bonReportsSortValue(
  report: ReportRow,
  key: SortKey,
  regionLabels: Record<string, string>
): SortValue {
  if (key === "username") {
    return report.username.toLowerCase();
  }

  if (key === "count") {
    return report.count || 0;
  }

  if (key === "verdict") {
    const verdict =
      bonInvestigationResults(report.investigation)?.verdict ?? null;

    return verdict ? (BON_REPORTS_VERDICT_RANK[verdict] ?? 5) : 5;
  }

  if (key === "investigatedAt") {
    const investigation: Investigation | null = report.investigation;
    if (!investigation) {
      return 0;
    }

    // For an in-flight re-investigation, prefer the active phase's
    // timestamp so a freshly-kicked row floats to the top instead of
    // staying anchored to its prior runAt.
    if (investigation.status === "running") {
      return investigation.startedAt ?? 0;
    }

    if (investigation.status === "queued") {
      return investigation.queuedAt ?? 0;
    }

    if (investigation.status === "done") {
      return investigation.results.runAt;
    }

    return 0;
  }

  if (key === "region") {
    // Sort by region label so same-country rows cluster; rows with no
    // inferred region sink to the bottom.
    const region = bonReportsComputeRegionForReport(report);
    if (!region) {
      return "￿";
    }

    if (region.kind === "ai" || region.kind === "deterministic") {
      return (regionLabels[region.region] || region.region) + "_a";
    }

    return "￾_" + (region.offsetHours ?? 99);
  }

  return null;
}

export function bonReportsCompareBy(
  key: SortKey,
  dir: SortDir,
  regionLabels: Record<string, string>
): (a: ReportRow, b: ReportRow) => number {
  const multiplier = dir === "asc" ? 1 : -1;

  return (a, b) => {
    const aValue = bonReportsSortValue(a, key, regionLabels);
    const bValue = bonReportsSortValue(b, key, regionLabels);

    if (aValue == null && bValue == null) {
      return 0;
    }

    if (aValue == null) {
      return 1;
    }

    if (bValue == null) {
      return -1;
    }

    if (aValue < bValue) {
      return -1 * multiplier;
    }

    if (aValue > bValue) {
      return 1 * multiplier;
    }

    const aTime = a.lastReportedAt || 0;
    const bTime = b.lastReportedAt || 0;
    return bTime - aTime;
  };
}
