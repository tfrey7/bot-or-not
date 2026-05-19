// Investigation analytics dashboard — entry point + orchestrator.
//
// `bonRenderAnalytics(reports, container)` is the only public API. It wipes
// the container, asks logic.js for the run list + summary stats, then composes
// the page from the widget files in this directory (stat_grid, chart_*,
// table_*). Each widget owns its own DOM building; this file just decides
// the order they appear in.

import type { Report } from "../../types.ts";
import {
  bonFmtNum,
  bonFmtPercent,
  bonFmtThousands,
  bonFmtUsd,
} from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonAnalyticsActivityChart } from "./chart_activity.ts";
import { bonAnalyticsChartCard } from "./chart_card.ts";
import { bonAnalyticsCostChart } from "./chart_cost.ts";
import { bonAnalyticsDurationChart } from "./chart_duration.ts";
import { bonAnalyticsTokenMix } from "./chart_tokens.ts";
import {
  bonAnalyticsCollect,
  bonAnalyticsSummarize,
  type AnalyticsSummary,
} from "./logic.ts";
import { bonAnalyticsStatGrid } from "./stat_grid.ts";
import { bonAnalyticsModelsTable } from "./table_models.ts";
import { bonAnalyticsRunLog } from "./table_run_log.ts";
import { bonAnalyticsTopSpenders } from "./table_top_spenders.ts";

export function bonRenderAnalytics(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null
): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const investigations = bonAnalyticsCollect(reports);
  const runs = investigations.filter(
    (investigation) => investigation.status === "done"
  );
  const errors = investigations.filter(
    (investigation) => investigation.status === "error"
  ).length;

  const section = document.createElement("section");
  section.className = "bon-analytics";
  section.appendChild(buildHeader(runs.length, errors));

  if (!runs.length) {
    section.appendChild(buildEmptyState());
    container.appendChild(section);
    return;
  }

  const summary = bonAnalyticsSummarize(runs);
  section.appendChild(bonAnalyticsStatGrid(summary));

  const charts = document.createElement("div");
  charts.className = "bon-analytics-charts";

  charts.appendChild(
    bonAnalyticsChartCard(
      "Cumulative spend",
      runs.length === 1
        ? `${bonFmtUsd(summary.totalCost)} on a single run`
        : `${bonFmtUsd(summary.totalCost)} across ${runs.length} investigations`,
      bonAnalyticsCostChart(runs, summary)
    )
  );
  charts.appendChild(
    bonAnalyticsChartCard(
      "Investigations per day",
      `${summary.daysActive} active day${summary.daysActive === 1 ? "" : "s"} · ${bonFmtNum(summary.runsPerActiveDay, 1)} avg / active day`,
      bonAnalyticsActivityChart(runs)
    )
  );
  charts.appendChild(
    bonAnalyticsChartCard(
      "Duration distribution",
      `median ${bonFmtDuration(summary.medianDuration)} · p95 ${bonFmtDuration(summary.p95Duration)}`,
      bonAnalyticsDurationChart(runs)
    )
  );
  charts.appendChild(
    bonAnalyticsChartCard(
      "Token economy",
      `${bonFmtThousands(summary.totalTokens)} tokens · ${bonFmtPercent(summary.cacheHitRate, 0)} served from cache`,
      bonAnalyticsTokenMix(summary)
    )
  );
  section.appendChild(charts);

  section.appendChild(bonAnalyticsModelsTable(runs));
  section.appendChild(bonAnalyticsTopSpenders(runs));
  section.appendChild(bonAnalyticsRunLog(runs));
  section.appendChild(buildFootnote(summary));

  container.appendChild(section);
}

// Page chrome — three tiny helpers used only by the orchestrator. Kept
// inline rather than split into their own files: each is a few lines, and
// they're called in a single linear sequence from bonRenderAnalytics.

function buildHeader(count: number, errors: number): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-analytics-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Investigation analytics";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-analytics-subtitle";

  if (count > 0) {
    let text = `Cost, timing, and token usage across ${count} completed investigation${count === 1 ? "" : "s"}`;

    if (errors) {
      text += ` (${errors} failed run${errors === 1 ? "" : "s"} excluded)`;
    }

    sub.textContent = text + ".";
  } else {
    sub.textContent =
      "Cost, timing, and token usage across all completed investigations.";
  }

  header.appendChild(sub);
  return header;
}

function buildEmptyState(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "bon-analytics-empty";
  div.textContent =
    "No completed investigations yet. Click 🤖 on a reported user to run one — stats will populate here.";
  return div;
}

function buildFootnote(summary: AnalyticsSummary): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "bon-analytics-footnote";

  const parts: string[] = [
    `Bot or Not v${browser.runtime.getManifest().version}`,
  ];

  if (summary.firstRunAt) {
    parts.push(
      `earliest run ${new Date(summary.firstRunAt).toLocaleDateString()}`
    );
  }

  if (summary.lastRunAt) {
    parts.push(`latest ${new Date(summary.lastRunAt).toLocaleDateString()}`);
  }

  parts.push(
    "costs are estimated from per-token pricing; check your Anthropic console for billed amounts"
  );
  paragraph.textContent = parts.join(" · ") + ".";
  return paragraph;
}
