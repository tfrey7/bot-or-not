// Pure transforms / helpers for the reports page table itself: active/queue
// ordering, running-row labels, structural-change detection, table sorting.
// No DOM, no I/O.
//
// Topic-specific helpers live in sibling files:
//   - `region.ts` for per-report region + timezone inference
//   - `subreddit_chart_data.ts` for the subreddit chart's bucket math

import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import type { Investigation, Report } from "../../types.ts";
import { expectedDurationSec } from "../../utils/expected_duration.ts";
import { investigationResults } from "../../utils/history.ts";
import { isInvestigationStale } from "../../verdict.ts";
import { REDDITORS_VERDICT_RANK } from "./data.ts";
import { redditorsComputeRegionForReport } from "./region.ts";

export type ReportRow = Report & { username: string };

// Rows that belong above the divider — currently running or waiting in the
// queue. Everything else (done, errored, never investigated) sinks into the
// main list. Stale running counts as active until the sweeper rewrites it
// to "error"; that way an obviously-stuck row doesn't quietly disappear.
export function redditorsIsActiveRow(report: ReportRow): boolean {
  const status = report.investigation?.status;
  return status === "running" || status === "queued";
}

// Sort order for the active table: running before queued, newest-started
// running first, then within the queue higher-priority first and oldest-
// queued first within a priority tier (matches the background's pickup
// order — p-queue drains highest priority, FIFO within ties).
export function redditorsCompareActive(a: ReportRow, b: ReportRow): number {
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

  const aPriority = a.investigation?.priority ?? QUEUE_PRIORITY.bulk;
  const bPriority = b.investigation?.priority ?? QUEUE_PRIORITY.bulk;
  if (aPriority !== bPriority) {
    return bPriority - aPriority;
  }

  const aQueued = a.investigation?.queuedAt ?? 0;
  const bQueued = b.investigation?.queuedAt ?? 0;
  return aQueued - bQueued;
}

// Number of queued investigations that will be picked before `target` —
// higher priority first, then older queuedAt within a priority tier (the
// background's pickup order). Returns 0 if `target` isn't queued.
export function redditorsCountQueuedAhead(
  reports: ReportRow[],
  target: ReportRow
): number {
  const myQueuedAt = target.investigation?.queuedAt;
  if (target.investigation?.status !== "queued" || myQueuedAt == null) {
    return 0;
  }

  const myPriority = target.investigation.priority ?? QUEUE_PRIORITY.bulk;

  let ahead = 0;

  for (const report of reports) {
    if (report.username === target.username) {
      continue;
    }

    const investigation = report.investigation;
    if (investigation?.status !== "queued") {
      continue;
    }

    const priority = investigation.priority ?? QUEUE_PRIORITY.bulk;

    if (priority > myPriority) {
      ahead++;
      continue;
    }

    if (
      priority === myPriority &&
      investigation.queuedAt != null &&
      investigation.queuedAt < myQueuedAt
    ) {
      ahead++;
    }
  }

  return ahead;
}

export function redditorsFormatRunningCellText(
  elapsedSec: number,
  expectedMs: number | null | undefined
): string {
  if (!expectedMs) {
    return `Running… ${elapsedSec}s`;
  }

  return `Running… ${elapsedSec}s / ~${expectedDurationSec(expectedMs)}s`;
}

export function redditorsFormatRunningTitle(
  elapsedSec: number,
  expectedMs: number | null | undefined
): string {
  if (!expectedMs) {
    return `Investigation running… ${elapsedSec}s elapsed (large accounts can take 60–90s)`;
  }

  const expSec = expectedDurationSec(expectedMs);
  if (elapsedSec > expSec) {
    return `Running ${elapsedSec}s — longer than the typical ${expSec}s. Hang tight.`;
  }

  const remaining = Math.max(0, expSec - elapsedSec);
  return `Running ${elapsedSec}s · ~${remaining}s left (typical ${expSec}s)`;
}

export function redditorsDiagnoseLoadError(
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

// Stable string snapshot of the parts of `report` (plus queue position) that
// the detail pane actually renders. Used to bail out of a re-render when a
// structural change in some *other* row triggers the page-level render —
// without this check, the polaroid slideshow + elapsed timer in the loading
// widget for the selected user get torn down and rebuilt every time any
// sibling investigation completes.
export function redditorsDetailFingerprint(
  report: ReportRow | null,
  queueAhead: number,
  hasAnyReports: boolean
): string {
  if (!report) {
    return hasAnyReports ? "empty:list" : "empty:none";
  }

  return [
    report.username,
    detailInvestigationSig(report.investigation),
    `q${queueAhead}`,
    `c${report.count}`,
    `lr${report.lastReportedAt}`,
    `ring${report.ringId ?? ""}`,
  ].join("|");
}

function detailInvestigationSig(investigation: Investigation | null): string {
  if (!investigation) {
    return "inv:null";
  }

  if (investigation.status === "done") {
    return `inv:done:${investigation.results.runAt}`;
  }

  if (investigation.status === "error") {
    return `inv:error:${investigation.error ?? ""}`;
  }

  if (investigation.status === "running") {
    const stale = isInvestigationStale(investigation) ? "s" : "f";
    return `inv:running:${investigation.startedAt ?? 0}:${stale}`;
  }

  return `inv:queued:${investigation.queuedAt ?? 0}:${investigation.notBefore ?? 0}`;
}

export function redditorsHasStructuralChange(
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
      investigationResults(prevReport.investigation)?.verdict ?? null;
    const nextVerdict =
      investigationResults(report.investigation)?.verdict ?? null;

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
      isInvestigationStale(prevReport.investigation);
    const nextStale =
      nextStatus === "running" && isInvestigationStale(report.investigation);

    if (prevStale !== nextStale) {
      return true;
    }
  }

  return false;
}

export type SortKey =
  "username" | "count" | "verdict" | "investigatedAt" | "region";

export type SortDir = "asc" | "desc";

type SortValue = string | number | null;

function redditorsSortValue(
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
    const verdict = investigationResults(report.investigation)?.verdict ?? null;

    return verdict ? (REDDITORS_VERDICT_RANK[verdict] ?? 5) : 5;
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
    const region = redditorsComputeRegionForReport(report);
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

export function redditorsCompareBy(
  key: SortKey,
  dir: SortDir,
  regionLabels: Record<string, string>
): (a: ReportRow, b: ReportRow) => number {
  const multiplier = dir === "asc" ? 1 : -1;

  return (a, b) => {
    const aValue = redditorsSortValue(a, key, regionLabels);
    const bValue = redditorsSortValue(b, key, regionLabels);

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
