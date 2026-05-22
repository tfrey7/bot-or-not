// API usage analytics — entry point + orchestrator.
//
// Two sections, one per upstream API: LLM (Claude today, other vendors
// later) and Reddit. Each section gets one chart per metric (cost /
// requests / latency on the LLM side; requests / latency on the Reddit
// side, no cost) plus a paginated run log on the LLM side. Module-level
// state tracks the current run-log page so polling-driven re-renders
// don't bounce the user back to page 1.

import type { Report } from "../../types.ts";
import { bonAnalyticsActivityChart } from "./chart_activity.ts";
import { bonAnalyticsChartCard } from "./chart_card.ts";
import { bonAnalyticsCostChart } from "./chart_cost.ts";
import { bonAnalyticsLatencyChart } from "./chart_latency.ts";
import { bonAnalyticsRedditLatencyChart } from "./chart_reddit_latency.ts";
import { bonAnalyticsRedditRequestsChart } from "./chart_reddit_requests.ts";
import { bonAnalyticsCollect, type AnalyticsEntry } from "./logic.ts";
import { bonAnalyticsRunLog } from "./table_run_log.ts";

let runLogPage = 1;

export function bonRenderAnalytics(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null
): void {
  if (!container) {
    return;
  }

  const investigations = bonAnalyticsCollect(reports);
  const runs = investigations.filter((entry) => entry.status === "done");

  // Reddit fetches are captured on errored runs too — rate-limit and
  // suspended-user failures are exactly what makes the Reddit metrics
  // useful — so include both done and error rows there.
  const redditEligible = investigations.filter(
    (entry) => entry.status === "done" || entry.status === "error"
  );
  const runsWithRedditMetrics = redditEligible.filter(
    (entry) => !!entry.redditMetrics
  ).length;

  renderInto(container, runs, redditEligible, runsWithRedditMetrics);
}

function renderInto(
  container: HTMLElement,
  llmRuns: AnalyticsEntry[],
  redditRuns: AnalyticsEntry[],
  runsWithRedditMetrics: number
): void {
  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "bon-analytics";

  section.appendChild(
    buildSectionHeader(
      "LLM API",
      llmRuns.length === 0
        ? "Cost, request rate, and latency across investigations."
        : `Cost, request rate, and latency across ${llmRuns.length} investigation${llmRuns.length === 1 ? "" : "s"}.`,
      "first"
    )
  );

  if (llmRuns.length === 0) {
    section.appendChild(
      buildEmptyState(
        "No completed investigations yet. Click 🤖 on a reported user to run one — stats will populate here."
      )
    );
  } else {
    const llmCharts = document.createElement("div");
    llmCharts.className = "bon-analytics-charts";
    llmCharts.appendChild(
      bonAnalyticsChartCard(
        "Cumulative spend",
        null,
        bonAnalyticsCostChart(llmRuns)
      )
    );
    llmCharts.appendChild(
      bonAnalyticsChartCard(
        "Requests per day",
        null,
        bonAnalyticsActivityChart(llmRuns)
      )
    );
    llmCharts.appendChild(
      bonAnalyticsChartCard(
        "Request latency",
        "p50 (accent) · p95 (rust)",
        bonAnalyticsLatencyChart(llmRuns)
      )
    );
    section.appendChild(llmCharts);

    section.appendChild(
      bonAnalyticsRunLog(llmRuns, {
        currentPage: runLogPage,
        onPageChange: (next) => {
          runLogPage = next;
          renderInto(container, llmRuns, redditRuns, runsWithRedditMetrics);
        },
      })
    );
  }

  section.appendChild(
    buildSectionHeader(
      "Reddit API",
      runsWithRedditMetrics === 0
        ? "Request rate and per-fetch latency."
        : `Request rate and per-fetch latency across ${runsWithRedditMetrics} investigation${runsWithRedditMetrics === 1 ? "" : "s"} with captured fetch metrics.`,
      "sub"
    )
  );

  if (runsWithRedditMetrics === 0) {
    section.appendChild(
      buildEmptyState(
        "No Reddit fetch metrics captured yet. Run an investigation to populate this section."
      )
    );
  } else {
    const redditCharts = document.createElement("div");
    redditCharts.className = "bon-analytics-charts";
    redditCharts.appendChild(
      bonAnalyticsChartCard(
        "Requests per day",
        null,
        bonAnalyticsRedditRequestsChart(redditRuns)
      )
    );
    redditCharts.appendChild(
      bonAnalyticsChartCard(
        "Request latency",
        "p50 (accent) · p95 (rust)",
        bonAnalyticsRedditLatencyChart(redditRuns)
      )
    );
    section.appendChild(redditCharts);
  }

  container.appendChild(section);
}

function buildSectionHeader(
  title: string,
  subtitle: string,
  position: "first" | "sub"
): HTMLElement {
  const header = document.createElement("header");
  header.className =
    position === "first" ? "bon-analytics-header" : "bon-analytics-subhead";

  const h2 = document.createElement("h2");
  h2.textContent = title;
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-analytics-subtitle";
  sub.textContent = subtitle;
  header.appendChild(sub);

  return header;
}

function buildEmptyState(text: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "bon-analytics-empty";
  div.textContent = text;
  return div;
}
