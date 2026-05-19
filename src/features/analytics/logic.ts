// Analytics — business logic. Pure transforms over the reports object:
// walks each user's investigation/runs[] history to build the flat list of
// analytics entries, and reduces that list into the summary stats object
// the renderer consumes. No DOM, no I/O.

import type {
  ClaudeUsage,
  Investigation,
  RedditEndpoint,
  RedditFetchMetric,
  RedditMetrics,
  Report,
  RunSnapshot,
  Verdict,
} from "../../types.ts";
import {
  bonEstimateCostUsd,
  bonLookupPricing,
  bonRecentCost,
} from "../../utils/cost.ts";
import { bonPercentile } from "../../utils/stats.ts";

export interface AnalyticsCall {
  kind: string;
  model: string | null;
  usage: ClaudeUsage | null;
  costUsd: number | null;
  webSearchCount: number;
}

export interface AnalyticsEntry {
  username: string;
  status: "running" | "done" | "error";
  runAt: number | null;
  durationMs: number | null;
  verdict: Verdict | null;
  confidence: number | null;
  botProbability: number | null;
  persona: string | null;
  summary: string;
  postsFetched: number;
  commentsFetched: number;
  calls: AnalyticsCall[];
  totalCost: number;
  redditMetrics: RedditMetrics | null;
}

export interface AnalyticsModelTotals {
  model: string;
  calls: number;
  cost: number;
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  duration: number;
}

export interface AnalyticsSummary {
  count: number;
  totalCost: number;
  totalDuration: number;
  totalApiCalls: number;
  totalWebSearches: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalPosts: number;
  totalComments: number;
  cacheSavingsUsd: number;
  models: Record<string, AnalyticsModelTotals>;
  daysActive: number;
  firstRunAt: number | null;
  lastRunAt: number | null;
  avgCost: number;
  medianCost: number;
  maxCost: number;
  avgDuration: number;
  medianDuration: number;
  p95Duration: number;
  totalTokens: number;
  cacheHitRate: number;
  runsPerActiveDay: number;
  recentCost: number;
  recentDays: number;
  reddit: AnalyticsRedditSummary;
}

export interface AnalyticsEndpointTotals {
  endpoint: RedditEndpoint;
  fetches: number;
  errors: number;
  totalDurationMs: number;
  durations: number[];
  totalItems: number;
  itemSamples: number;
  errorStatuses: Record<string, number>;
}

export interface AnalyticsRedditSummary {
  runsWithMetrics: number;
  totalFetches: number;
  totalErrors: number;
  errorRate: number;
  avgWallClockMs: number;
  medianWallClockMs: number;
  p95WallClockMs: number;
  endpoints: AnalyticsEndpointTotals[];
}

// Anything with the per-run fields buildAnalyticsEntry looks at.
type RunLike = RunSnapshot | Investigation;

export function bonAnalyticsCollect(
  reports: Array<Report & { username: string }> | null | undefined
): AnalyticsEntry[] {
  const entries: AnalyticsEntry[] = [];

  for (const report of reports || []) {
    const investigation = report?.investigation;

    if (!investigation) {
      continue;
    }

    // Newer records keep a runs[] history; emit one analytics entry per
    // historical run so re-investigations don't collapse into a single row.
    if (Array.isArray(investigation.runs) && investigation.runs.length > 0) {
      for (const run of investigation.runs) {
        entries.push(buildAnalyticsEntry(report.username, run));
      }

      // If a run is currently in flight, runs[] doesn't include it yet —
      // skip it (analytics only cares about completed runs).
      continue;
    }

    // Legacy record (single most-recent run only). Treat the root fields as
    // one run.
    entries.push(buildAnalyticsEntry(report.username, investigation));
  }

  return entries;
}

function buildAnalyticsEntry(username: string, run: RunLike): AnalyticsEntry {
  const calls: AnalyticsCall[] = [];

  if (run.usage) {
    calls.push({
      kind: "1d",
      model: run.model || null,
      usage: run.usage,
      costUsd:
        typeof run.costUsd === "number"
          ? run.costUsd
          : bonEstimateCostUsd(run.usage, run.model, run.webSearchCount),
      webSearchCount: run.webSearchCount || 0,
    });
  }

  const totalCost = calls.reduce((sum, call) => sum + (call.costUsd || 0), 0);
  const personaLabel =
    "persona" in run && run.persona && typeof run.persona === "object"
      ? (run.persona as { label?: string }).label || null
      : null;

  return {
    username,
    status: (run.status || "done") as AnalyticsEntry["status"],
    runAt: run.runAt || null,
    durationMs: typeof run.durationMs === "number" ? run.durationMs : null,
    verdict: (run.verdict as Verdict | undefined) || null,
    confidence: typeof run.confidence === "number" ? run.confidence : null,
    botProbability:
      typeof run.botProbability === "number" ? run.botProbability : null,
    persona: personaLabel,
    summary:
      "summary" in run && typeof run.summary === "string" ? run.summary : "",
    postsFetched: run.postsFetched || 0,
    commentsFetched: run.commentsFetched || 0,
    calls,
    totalCost,
    redditMetrics:
      "redditMetrics" in run && run.redditMetrics ? run.redditMetrics : null,
  };
}

// All five Reddit endpoints we currently hit. Listed explicitly (rather
// than derived from observed metrics) so the per-endpoint chart always
// renders the same row order even when an endpoint has zero fetches.
const BON_REDDIT_ENDPOINTS: RedditEndpoint[] = [
  "about",
  "submitted",
  "comments",
  "moderated",
  "botbouncer",
];

export function bonSummarizeRedditMetrics(
  runs: AnalyticsEntry[]
): AnalyticsRedditSummary {
  const totals: Record<RedditEndpoint, AnalyticsEndpointTotals> = {} as Record<
    RedditEndpoint,
    AnalyticsEndpointTotals
  >;

  for (const endpoint of BON_REDDIT_ENDPOINTS) {
    totals[endpoint] = {
      endpoint,
      fetches: 0,
      errors: 0,
      totalDurationMs: 0,
      durations: [],
      totalItems: 0,
      itemSamples: 0,
      errorStatuses: {},
    };
  }

  const wallClocks: number[] = [];
  let runsWithMetrics = 0;
  let totalFetches = 0;
  let totalErrors = 0;

  for (const run of runs) {
    if (!run.redditMetrics) {
      continue;
    }

    runsWithMetrics++;
    if (run.redditMetrics.totalDurationMs > 0) {
      wallClocks.push(run.redditMetrics.totalDurationMs);
    }

    for (const fetch of run.redditMetrics.fetches) {
      const bucket = totals[fetch.endpoint];
      if (!bucket) {
        continue;
      }

      bucket.fetches++;
      totalFetches++;
      bucket.totalDurationMs += fetch.durationMs;
      bucket.durations.push(fetch.durationMs);

      if (fetch.status === "error") {
        bucket.errors++;
        totalErrors++;
        const statusKey = fetch.httpStatus
          ? String(fetch.httpStatus)
          : "network";
        bucket.errorStatuses[statusKey] =
          (bucket.errorStatuses[statusKey] || 0) + 1;
      }

      if (typeof fetch.itemCount === "number") {
        bucket.totalItems += fetch.itemCount;
        bucket.itemSamples++;
      }
    }
  }

  wallClocks.sort((a, b) => a - b);
  const sumWall = wallClocks.reduce((acc, value) => acc + value, 0);

  return {
    runsWithMetrics,
    totalFetches,
    totalErrors,
    errorRate: totalFetches ? totalErrors / totalFetches : 0,
    avgWallClockMs: wallClocks.length ? sumWall / wallClocks.length : 0,
    medianWallClockMs: bonPercentile(wallClocks, 0.5),
    p95WallClockMs: bonPercentile(wallClocks, 0.95),
    endpoints: BON_REDDIT_ENDPOINTS.map((endpoint) => totals[endpoint]),
  };
}

export function bonAnalyticsRedditFetchTimeline(
  runs: AnalyticsEntry[]
): Array<{ runAt: number; totalDurationMs: number; hadError: boolean }> {
  const out: Array<{
    runAt: number;
    totalDurationMs: number;
    hadError: boolean;
  }> = [];

  for (const run of runs) {
    if (!run.redditMetrics || !run.runAt) {
      continue;
    }

    out.push({
      runAt: run.runAt,
      totalDurationMs: run.redditMetrics.totalDurationMs,
      hadError: run.redditMetrics.fetches.some(
        (fetch: RedditFetchMetric) => fetch.status === "error"
      ),
    });
  }

  out.sort((a, b) => a.runAt - b.runAt);
  return out;
}

export function bonAnalyticsSummarize(
  runs: AnalyticsEntry[]
): AnalyticsSummary {
  const summary: AnalyticsSummary = {
    count: runs.length,
    totalCost: 0,
    totalDuration: 0,
    totalApiCalls: 0,
    totalWebSearches: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalPosts: 0,
    totalComments: 0,
    cacheSavingsUsd: 0,
    models: {},
    daysActive: 0,
    firstRunAt: null,
    lastRunAt: null,
    avgCost: 0,
    medianCost: 0,
    maxCost: 0,
    avgDuration: 0,
    medianDuration: 0,
    p95Duration: 0,
    totalTokens: 0,
    cacheHitRate: 0,
    runsPerActiveDay: 0,
    recentCost: 0,
    recentDays: 7,
    reddit: {
      runsWithMetrics: 0,
      totalFetches: 0,
      totalErrors: 0,
      errorRate: 0,
      avgWallClockMs: 0,
      medianWallClockMs: 0,
      p95WallClockMs: 0,
      endpoints: [],
    },
  };
  const durations: number[] = [];
  const days = new Set<string>();
  let firstRun = Infinity;
  let lastRun = -Infinity;

  for (const run of runs) {
    summary.totalCost += run.totalCost;

    if (typeof run.durationMs === "number") {
      summary.totalDuration += run.durationMs;
      durations.push(run.durationMs);
    }

    summary.totalPosts += run.postsFetched;
    summary.totalComments += run.commentsFetched;

    if (run.runAt) {
      firstRun = Math.min(firstRun, run.runAt);
      lastRun = Math.max(lastRun, run.runAt);
      const day = new Date(run.runAt);
      days.add(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
    }

    for (const call of run.calls) {
      summary.totalApiCalls++;
      summary.totalWebSearches += call.webSearchCount || 0;
      const usage = call.usage || {};
      summary.totalInput += usage.input_tokens || 0;
      summary.totalOutput += usage.output_tokens || 0;
      summary.totalCacheRead += usage.cache_read_input_tokens || 0;
      summary.totalCacheWrite += usage.cache_creation_input_tokens || 0;

      if (call.model) {
        const modelTotals = summary.models[call.model] || {
          model: call.model,
          calls: 0,
          cost: 0,
          in: 0,
          out: 0,
          cacheRead: 0,
          cacheWrite: 0,
          duration: 0,
        };
        modelTotals.calls++;
        modelTotals.cost += call.costUsd || 0;
        modelTotals.in += usage.input_tokens || 0;
        modelTotals.out += usage.output_tokens || 0;
        modelTotals.cacheRead += usage.cache_read_input_tokens || 0;
        modelTotals.cacheWrite += usage.cache_creation_input_tokens || 0;
        summary.models[call.model] = modelTotals;
      }
    }
  }

  durations.sort((a, b) => a - b);
  summary.daysActive = days.size;
  summary.firstRunAt = isFinite(firstRun) ? firstRun : null;
  summary.lastRunAt = isFinite(lastRun) ? lastRun : null;
  summary.avgCost = summary.count ? summary.totalCost / summary.count : 0;
  summary.medianCost = summary.count
    ? bonPercentile(
        runs.map((run) => run.totalCost).sort((a, b) => a - b),
        0.5
      )
    : 0;
  summary.maxCost = summary.count
    ? Math.max(...runs.map((run) => run.totalCost))
    : 0;
  summary.avgDuration = durations.length
    ? summary.totalDuration / durations.length
    : 0;
  summary.medianDuration = bonPercentile(durations, 0.5);
  summary.p95Duration = bonPercentile(durations, 0.95);
  summary.totalTokens =
    summary.totalInput +
    summary.totalOutput +
    summary.totalCacheRead +
    summary.totalCacheWrite;
  summary.cacheHitRate =
    summary.totalInput + summary.totalCacheRead > 0
      ? summary.totalCacheRead / (summary.totalInput + summary.totalCacheRead)
      : 0;
  summary.runsPerActiveDay = summary.daysActive
    ? summary.count / summary.daysActive
    : 0;

  // Estimate dollars saved by cache reads vs. paying full input price.
  let savings = 0;

  for (const modelTotals of Object.values(summary.models)) {
    const pricing = bonLookupPricing(modelTotals.model);

    if (!pricing) {
      continue;
    }

    savings +=
      (modelTotals.cacheRead * (pricing.input - pricing.cacheRead)) / 1_000_000;
  }

  summary.cacheSavingsUsd = savings;

  // Burn rate over last 7 days of activity (only counting days with runs
  // to avoid a misleadingly low rate for sporadic use).
  summary.recentCost = bonRecentCost(runs, 7);
  summary.recentDays = 7;
  return summary;
}
