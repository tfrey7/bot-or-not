// Pure transforms / helpers for the reports page. No DOM, no I/O. The
// orchestrator and widget files all import from here so render code stays
// focused on building nodes from already-computed values.

import {
  bonInferRegion,
  type RegionInferenceResult,
} from "../regions/index.ts";
import type { ActivityData, Investigation, Report } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { BON_REPORTS_VERDICT_RANK } from "./data.ts";

export type ReportRow = Report & { username: string };

// Median across every prior completed run, including runs[] history.
// Returns null below 3 samples — not enough signal to predict against.
export function bonReportsExpectedDurationMs(
  allReports: ReportRow[]
): number | null {
  const durs: number[] = [];
  for (const r of allReports) {
    const inv = r.investigation;
    if (!inv) {
      continue;
    }

    if (Array.isArray(inv.runs) && inv.runs.length > 0) {
      for (const run of inv.runs) {
        if (run.status === "done" && typeof run.durationMs === "number") {
          durs.push(run.durationMs);
        }
      }
    } else if (inv.status === "done" && typeof inv.durationMs === "number") {
      durs.push(inv.durationMs);
    }
  }

  if (durs.length < 3) {
    return null;
  }

  durs.sort((a, b) => a - b);
  return durs[Math.floor(durs.length / 2)];
}

export function bonReportsFormatExpectedSec(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}

export function bonReportsFormatRunningCellText(
  elapsedSec: number,
  expectedMs: number | null | undefined
): string {
  if (!expectedMs) {
    return `Running… ${elapsedSec}s`;
  }
  return `Running… ${elapsedSec}s / ~${bonReportsFormatExpectedSec(expectedMs)}s`;
}

export function bonReportsFormatRunningTitle(
  elapsedSec: number,
  expectedMs: number | null | undefined
): string {
  if (!expectedMs) {
    return `Investigation running… ${elapsedSec}s elapsed (large accounts can take 60–90s)`;
  }

  const expSec = bonReportsFormatExpectedSec(expectedMs);
  if (elapsedSec > expSec) {
    return `Running ${elapsedSec}s — longer than the typical ${expSec}s. Hang tight.`;
  }

  const remaining = Math.max(0, expSec - elapsedSec);
  return `Running ${elapsedSec}s · ~${remaining}s left (typical ${expSec}s)`;
}

const BON_ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

export function bonReportsIsActivityFresh(
  activityData: ActivityData | null | undefined
): boolean {
  return (
    !!activityData?.fetchedAt &&
    Date.now() - activityData.fetchedAt < BON_ACTIVITY_TTL_MS
  );
}

export function bonReportsSanitizeUsernameQuery(
  raw: string | null | undefined
): string | null {
  const trimmed = (raw || "").trim().replace(/^\/?u\//i, "");

  if (!/^[A-Za-z0-9_-]{3,20}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function bonReportsDiagnoseLoadError(
  message: string | null | undefined
): string {
  const msg = (message || "").toLowerCase();

  if (
    msg.includes("receiving end does not exist") ||
    msg.includes("could not establish connection") ||
    msg.includes("message port closed")
  ) {
    return "The extension background worker isn't responding. This usually happens after the extension was reloaded or updated while this page was open. Reload the page to reconnect.";
  }

  if (msg.includes("quota") || msg.includes("storage")) {
    return "Browser storage may be full or unavailable. Try clearing some reports or checking your browser's extension storage permissions.";
  }

  if (msg.includes("undefined") || msg.includes("cannot read")) {
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

  const prevByUser = new Map(prev.map((r) => [r.username, r]));

  for (const r of next) {
    const p = prevByUser.get(r.username);
    if (!p) {
      return true;
    }

    const ps = p.investigation?.status;
    const ns = r.investigation?.status;
    if (ps !== ns) {
      return true;
    }
    if (p.investigation?.verdict !== r.investigation?.verdict) {
      return true;
    }
    if (p.count !== r.count) {
      return true;
    }
    if (p.lastReportedAt !== r.lastReportedAt) {
      return true;
    }

    const pStale = ps === "running" && bonIsInvestigationStale(p.investigation);
    const nStale = ns === "running" && bonIsInvestigationStale(r.investigation);
    if (pStale !== nStale) {
      return true;
    }
  }
  return false;
}

export type TimezoneInference =
  | { kind: "insufficient"; count: number }
  | { kind: "flat"; ratio: number; total: number }
  | {
      kind: "inferred";
      offsetHours: number;
      sleepStartUtc: number;
      sleepEndUtc: number;
      total: number;
      confidence: number;
    };

// Infer the profile user's timezone from when they post. Humans have a
// daily sleep window; finding the 6-hour low in UTC posting activity and
// assuming its midpoint is ~03:00 local gives a rough offset.
export function bonReportsInferTimezoneFromTimestamps(
  timestamps: number[] | null | undefined
): TimezoneInference {
  if (!timestamps || timestamps.length < 20) {
    return { kind: "insufficient", count: timestamps?.length || 0 };
  }

  const utcCounts = new Array<number>(24).fill(0);
  for (const t of timestamps) {
    utcCounts[new Date(t).getUTCHours()]++;
  }

  const WINDOW = 6;
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minStart = 0;

  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < WINDOW; i++) {
      sum += utcCounts[(start + i) % 24];
    }
    if (sum < minSum) {
      minSum = sum;
      minStart = start;
    }
    if (sum > maxSum) {
      maxSum = sum;
    }
  }

  const total = utcCounts.reduce((a, b) => a + b, 0);
  const ratio = maxSum > 0 ? minSum / maxSum : 1;

  // If the quietest 6h window holds more than half what the busiest does,
  // there's no clear sleep period — flag it (a documented bot signal).
  if (ratio > 0.5) {
    return { kind: "flat", ratio, total };
  }

  const sleepMidUtc = (minStart + WINDOW / 2) % 24;

  let offset = 3 - sleepMidUtc;
  if (offset > 12) {
    offset -= 24;
  }
  if (offset <= -12) {
    offset += 24;
  }

  const rounded = Math.round(offset);
  return {
    kind: "inferred",
    offsetHours: rounded,
    sleepStartUtc: minStart,
    sleepEndUtc: (minStart + WINDOW) % 24,
    total,
    confidence: 1 - ratio,
  };
}

export function bonReportsComputeRegionForReport(
  report: ReportRow
): RegionInferenceResult {
  const activityData = report.activityData;
  const timestamps = [
    ...(activityData?.postTimestamps || []),
    ...(activityData?.commentTimestamps || []),
  ];

  const tz = bonReportsInferTimezoneFromTimestamps(timestamps);
  return bonInferRegion(activityData, tz);
}

export function bonReportsComputeEarliestFullyVisible(
  activityData: ActivityData
): number | null {
  const { postsLimited, commentsLimited, earliestPostAt, earliestCommentAt } =
    activityData;

  const bounds: number[] = [];
  if (postsLimited && earliestPostAt) {
    bounds.push(earliestPostAt);
  }
  if (commentsLimited && earliestCommentAt) {
    bounds.push(earliestCommentAt);
  }

  if (bounds.length === 0) {
    return null;
  }

  return Math.max(...bounds);
}

export type SortKey =
  | "username"
  | "count"
  | "lastReportedAt"
  | "verdict"
  | "investigatedAt"
  | "region";

export type SortDir = "asc" | "desc";

export function bonReportsDefaultDirFor(key: SortKey): SortDir {
  if (key === "username" || key === "verdict") {
    return "asc";
  }

  return "desc";
}

type SortValue = string | number | null;

export function bonReportsSortValue(
  r: ReportRow,
  key: SortKey,
  regionLabels: Record<string, string>
): SortValue {
  if (key === "username") {
    return r.username.toLowerCase();
  }
  if (key === "count") {
    return r.count || 0;
  }
  if (key === "lastReportedAt") {
    return r.lastReportedAt || 0;
  }
  if (key === "verdict") {
    const v = r.investigation?.verdict;
    return v ? (BON_REPORTS_VERDICT_RANK[v] ?? 5) : 5;
  }
  if (key === "investigatedAt") {
    const inv: Investigation | null = r.investigation;
    if (!inv) {
      return 0;
    }

    // While running, runAt isn't written yet — fall back to startedAt so a
    // freshly-kicked-off investigation sorts to the top instead of the
    // bottom.
    return inv.runAt || inv.startedAt || 0;
  }
  if (key === "region") {
    // Sort by region label so same-country rows cluster; rows with no
    // inferred region sink to the bottom.
    const region = bonReportsComputeRegionForReport(r);
    if (!region) {
      return "￿";
    }

    if (region.kind === "deterministic") {
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
  const mult = dir === "asc" ? 1 : -1;

  return (a, b) => {
    const av = bonReportsSortValue(a, key, regionLabels);
    const bv = bonReportsSortValue(b, key, regionLabels);

    if (av == null && bv == null) {
      return 0;
    }
    if (av == null) {
      return 1;
    }
    if (bv == null) {
      return -1;
    }
    if (av < bv) {
      return -1 * mult;
    }
    if (av > bv) {
      return 1 * mult;
    }

    const aTime = a.lastReportedAt || 0;
    const bTime = b.lastReportedAt || 0;
    return bTime - aTime;
  };
}
