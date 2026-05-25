// Daily Reddit fetch latency — p50/p95 over individual per-endpoint
// fetch durations (every entry in RedditMetrics.fetches, not the
// wall-clock per-investigation total).

import type { AnalyticsEntry } from "./logic.ts";
import { analyticsDailyLatencyChart } from "./chart_latency.ts";
import { analyticsEmptyPanel } from "./uplot_helpers.ts";

export function analyticsRedditLatencyChart(
  runs: AnalyticsEntry[]
): HTMLElement {
  const samples: Array<{ runAt: number; durationMs: number }> = [];

  for (const run of runs) {
    if (!run.runAt || !run.redditMetrics) {
      continue;
    }

    for (const fetch of run.redditMetrics.fetches) {
      samples.push({ runAt: run.runAt, durationMs: fetch.durationMs });
    }
  }

  if (!samples.length) {
    return analyticsEmptyPanel("No Reddit fetch timing data yet.");
  }

  return analyticsDailyLatencyChart(samples, "fetch");
}
