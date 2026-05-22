// Daily Reddit fetch latency — p50/p95 over individual per-endpoint
// fetch durations (every entry in RedditMetrics.fetches, not the
// wall-clock per-investigation total).

import type { AnalyticsEntry } from "./logic.ts";
import { bonAnalyticsDailyLatencyChart } from "./chart_latency.ts";
import { bonAnalyticsEmptyPanel } from "./uplot_helpers.ts";

export function bonAnalyticsRedditLatencyChart(
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
    return bonAnalyticsEmptyPanel("No Reddit fetch timing data yet.");
  }

  return bonAnalyticsDailyLatencyChart(samples, "fetch");
}
