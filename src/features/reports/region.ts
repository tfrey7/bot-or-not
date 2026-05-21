// Per-report region inference. Combines the deterministic region pipeline
// (subreddit / script / language / moderator signals + timezone) with the
// AI's region pick, and exposes the timezone-from-timestamps helper that
// feeds both the deterministic pipeline and the hour heatmap.

import { bonInferRegion, type RegionInferenceResult } from "../regions";
import { bonInvestigationResults } from "../../utils/history.ts";
import type { ReportRow } from "./logic.ts";

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

  const aiRegion =
    bonInvestigationResults(report.investigation)?.region ?? null;

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
