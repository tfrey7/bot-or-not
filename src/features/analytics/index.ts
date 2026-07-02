// API usage analytics — entry point + orchestrator.
//
// Two sections, one per upstream API: LLM (Claude today, other vendors
// later) and Reddit. Each section gets one chart per metric (cost /
// requests / latency on the LLM side; requests / latency on the Reddit
// side, no cost) plus a paginated run log on the LLM side. Module-level
// state tracks the current run-log page so polling-driven re-renders
// don't bounce the user back to page 1.

import { clientSend } from "../../client.ts";
import type { BlocklistCleanupState } from "../../storage";
import type { Report } from "../../types.ts";
import { analyticsSweepBlocklistCard } from "./card_sweep_blocklist.ts";
import { analyticsSweepRecheckCard } from "./card_sweep_recheck.ts";
import { analyticsActivityChart } from "./chart_activity.ts";
import { analyticsChartCard } from "./chart_card.ts";
import { analyticsCostChart } from "./chart_cost.ts";
import { analyticsLatencyChart } from "./chart_latency.ts";
import { analyticsRedditLatencyChart } from "./chart_reddit_latency.ts";
import { analyticsRedditRequestsChart } from "./chart_reddit_requests.ts";
import { analyticsCollect, type AnalyticsEntry } from "./logic.ts";
import { analyticsRunLog } from "./table_run_log.ts";

let runLogPage = 1;

export async function renderAnalyticsTab(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null
): Promise<void> {
  if (!container) {
    return;
  }

  const investigations = analyticsCollect(reports);
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

  const blocklistState = await clientSend<BlocklistCleanupState>({
    type: "get-blocklist-cleanup-state",
  });

  renderInto(
    container,
    runs,
    redditEligible,
    runsWithRedditMetrics,
    reports,
    blocklistState
  );
}

function renderInto(
  container: HTMLElement,
  llmRuns: AnalyticsEntry[],
  redditRuns: AnalyticsEntry[],
  runsWithRedditMetrics: number,
  reports: Report[],
  blocklistState: BlocklistCleanupState
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
    section.appendChild(
      analyticsRunLog(llmRuns, {
        currentPage: runLogPage,
        onPageChange: (next) => {
          runLogPage = next;
          renderInto(
            container,
            llmRuns,
            redditRuns,
            runsWithRedditMetrics,
            reports,
            blocklistState
          );
        },
      })
    );

    const llmCharts = document.createElement("div");
    llmCharts.className = "bon-analytics-charts";
    llmCharts.appendChild(
      analyticsChartCard("Spend per day", null, analyticsCostChart(llmRuns))
    );
    llmCharts.appendChild(
      analyticsChartCard(
        "Requests per day",
        null,
        analyticsActivityChart(llmRuns)
      )
    );
    llmCharts.appendChild(
      analyticsChartCard(
        "Request latency",
        "p50 (accent) · p95 (rust)",
        analyticsLatencyChart(llmRuns)
      )
    );
    section.appendChild(llmCharts);
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
      analyticsChartCard(
        "Requests per day",
        null,
        analyticsRedditRequestsChart(redditRuns)
      )
    );
    redditCharts.appendChild(
      analyticsChartCard(
        "Request latency",
        "p50 (accent) · p95 (rust)",
        analyticsRedditLatencyChart(redditRuns)
      )
    );
    section.appendChild(redditCharts);
  }

  section.appendChild(
    buildSectionHeader(
      "Background sweeps",
      "Self-paced hygiene passes over the Reddit funnel: tombstoning removed accounts and clearing them off the block list.",
      "sub"
    )
  );

  const sweepCards = document.createElement("div");
  sweepCards.className = "bon-analytics-charts";
  sweepCards.appendChild(analyticsSweepRecheckCard(reports));
  sweepCards.appendChild(analyticsSweepBlocklistCard(blocklistState));
  section.appendChild(sweepCards);

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
