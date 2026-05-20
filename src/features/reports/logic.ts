// Pure transforms / helpers for the reports page. No DOM, no I/O. The
// orchestrator and widget files all import from here so render code stays
// focused on building nodes from already-computed values.

import { bonInferRegion, type RegionInferenceResult } from "../regions";
import type { ActivityData, Investigation, Report } from "../../types.ts";
import { bonExpectedDurationSec } from "../../utils/expected_duration.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { BON_REPORTS_VERDICT_RANK } from "./data.ts";

export type ReportRow = Report & { username: string };

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

// Decide whether the input box is being used to search or to compose an
// AI command. Anything that's pure username/path characters (or empty) is
// search-shaped; the moment a space or punctuation creeps in, treat it as
// a pending command so the table doesn't flicker to "no results" while
// the operator is mid-sentence.
export function bonReportsInputIsCommand(raw: string): boolean {
  const value = raw.trim();
  if (!value) {
    return false;
  }

  return !/^[A-Za-z0-9_/\\-]+$/.test(value);
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

    if (prevReport.investigation?.verdict !== report.investigation?.verdict) {
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

  for (const timestamp of timestamps) {
    utcCounts[new Date(timestamp).getUTCHours()]++;
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

  const timezone = bonReportsInferTimezoneFromTimestamps(timestamps);
  const deterministic = bonInferRegion(activityData, timezone);

  const aiRegion = report.investigation?.region;
  if (aiRegion?.code) {
    return {
      kind: "ai",
      region: aiRegion.code,
      confidence: aiRegion.confidence,
      reasoning: aiRegion.reasoning,
      deterministic,
    };
  }

  return deterministic;
}

export interface SubredditTimeline {
  sub: string;
  posts: number;
  comments: number;
  total: number;
  firstSeen: number;
  lastSeen: number;
  postEvents: number[];
  commentEvents: number[];
}

// Buckets each visible post/comment into a per-subreddit timeline. Returns
// null when the snapshot predates the parallel `postSubreddits` /
// `commentSubreddits` arrays — the renderer surfaces a "refresh" prompt.
export function bonReportsBuildSubredditTimelines(
  activityData: ActivityData
): SubredditTimeline[] | null {
  const postSubs = activityData.postSubreddits;
  const commentSubs = activityData.commentSubreddits;
  if (!postSubs || !commentSubs) {
    return null;
  }

  const byName = new Map<string, { posts: number[]; comments: number[] }>();

  const ensure = (sub: string) => {
    let bucket = byName.get(sub);
    if (!bucket) {
      bucket = { posts: [], comments: [] };
      byName.set(sub, bucket);
    }

    return bucket;
  };

  const postTimestamps = activityData.postTimestamps;

  for (let i = 0; i < postTimestamps.length; i++) {
    const sub = postSubs[i];
    if (!sub) {
      continue;
    }

    ensure(sub).posts.push(postTimestamps[i]);
  }

  const commentTimestamps = activityData.commentTimestamps;

  for (let i = 0; i < commentTimestamps.length; i++) {
    const sub = commentSubs[i];
    if (!sub) {
      continue;
    }

    ensure(sub).comments.push(commentTimestamps[i]);
  }

  const timelines: SubredditTimeline[] = [];

  for (const [sub, { posts, comments }] of byName) {
    posts.sort((a, b) => a - b);
    comments.sort((a, b) => a - b);

    const all = [...posts, ...comments];
    if (all.length === 0) {
      continue;
    }

    timelines.push({
      sub,
      posts: posts.length,
      comments: comments.length,
      total: all.length,
      firstSeen: Math.min(...all),
      lastSeen: Math.max(...all),
      postEvents: posts,
      commentEvents: comments,
    });
  }

  timelines.sort((a, b) => b.total - a.total);
  return timelines;
}

export interface SubredditChartSeries {
  label: string;
  total: number;
  isOther: boolean;
  bucketCounts: number[];
}

// Top-N subreddits as individual series, everything else collapsed into a
// single "other" series. Each series is bucketed across the same range so
// they line up on a shared X-axis. Posts and comments are merged into one
// "contribution" stream — the per-line chart distinguishes by subreddit,
// not by event kind.
export function bonReportsBuildSubredditChartSeries(
  timelines: SubredditTimeline[],
  rangeStart: number,
  rangeEnd: number,
  bucketCount: number,
  topN: number
): SubredditChartSeries[] {
  const span = rangeEnd - rangeStart;
  if (span <= 0 || timelines.length === 0) {
    return [];
  }

  const top = timelines.slice(0, topN);
  const rest = timelines.slice(topN);

  const bucketFor = (events: number[]): number[] => {
    const counts = new Array<number>(bucketCount).fill(0);

    for (const t of events) {
      if (t < rangeStart || t > rangeEnd) {
        continue;
      }

      const ratio = (t - rangeStart) / span;
      const index = Math.min(bucketCount - 1, Math.floor(ratio * bucketCount));
      counts[index]++;
    }

    return counts;
  };

  const series: SubredditChartSeries[] = top.map((timeline) => ({
    label: timeline.sub,
    total: timeline.total,
    isOther: false,
    bucketCounts: bucketFor([
      ...timeline.postEvents,
      ...timeline.commentEvents,
    ]),
  }));

  if (rest.length > 0) {
    const otherEvents: number[] = [];
    let otherTotal = 0;

    for (const timeline of rest) {
      otherEvents.push(...timeline.postEvents, ...timeline.commentEvents);
      otherTotal += timeline.total;
    }

    series.push({
      label: "other",
      total: otherTotal,
      isOther: true,
      bucketCounts: bucketFor(otherEvents),
    });
  }

  return series;
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
    const verdict = report.investigation?.verdict;
    return verdict ? (BON_REPORTS_VERDICT_RANK[verdict] ?? 5) : 5;
  }

  if (key === "investigatedAt") {
    const investigation: Investigation | null = report.investigation;
    if (!investigation) {
      return 0;
    }

    // While running, runAt isn't written yet — fall back to startedAt so a
    // freshly-kicked-off investigation sorts to the top instead of the
    // bottom.
    return investigation.runAt ?? investigation.startedAt ?? 0;
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
