// Top-of-page stat grid — 8 summary tiles (total spend, recent burn rate,
// API calls, tokens, durations, cache savings, Reddit items, cost/item).

import {
  bonFmtPercent,
  bonFmtThousands,
  bonFmtUsd,
} from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import type { AnalyticsSummary } from "./logic.ts";

export function bonAnalyticsStatGrid(
  summary: AnalyticsSummary
): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = "bon-analytics-stats";

  addStat(
    grid,
    "Total spent",
    bonFmtUsd(summary.totalCost),
    `${bonFmtUsd(summary.avgCost)} avg · ${bonFmtUsd(summary.medianCost)} median · ${bonFmtUsd(summary.maxCost)} max`
  );
  addStat(
    grid,
    "Spend last 7d",
    bonFmtUsd(summary.recentCost),
    summary.recentCost > 0
      ? `~${bonFmtUsd(summary.recentCost / summary.recentDays)} / day`
      : "no activity this week"
  );
  addStat(
    grid,
    "API requests",
    String(summary.totalApiCalls + summary.totalWebSearches),
    `${summary.totalApiCalls} Claude · ${summary.totalWebSearches} web search`
  );
  addStat(
    grid,
    "Total tokens",
    bonFmtThousands(summary.totalTokens),
    `${bonFmtThousands(summary.totalOutput)} output · ${bonFmtPercent(summary.cacheHitRate)} cached`
  );
  addStat(
    grid,
    "Median duration",
    bonFmtDuration(summary.medianDuration),
    `p95 ${bonFmtDuration(summary.p95Duration)} · ${bonFmtDuration(summary.totalDuration)} total compute`
  );
  addStat(
    grid,
    "Cache savings",
    bonFmtUsd(summary.cacheSavingsUsd),
    "vs. paying full input rate on cached reads"
  );
  addStat(
    grid,
    "Reddit fetched",
    bonFmtThousands(summary.totalPosts + summary.totalComments),
    `${bonFmtThousands(summary.totalPosts)} posts · ${bonFmtThousands(summary.totalComments)} comments`
  );
  addStat(
    grid,
    "Cost per Reddit item",
    summary.totalPosts + summary.totalComments > 0
      ? bonFmtUsd(
          summary.totalCost / (summary.totalPosts + summary.totalComments)
        )
      : "—",
    "post/comment analyzed"
  );

  return grid;
}

function addStat(
  parent: HTMLElement,
  label: string,
  value: string,
  sub?: string
): void {
  const card = document.createElement("div");
  card.className = "bon-analytics-stat";

  const labelEl = document.createElement("div");
  labelEl.className = "bon-stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "bon-stat-value";
  valueEl.textContent = value;

  card.appendChild(labelEl);
  card.appendChild(valueEl);

  if (sub) {
    const subEl = document.createElement("div");
    subEl.className = "bon-stat-sub";
    subEl.textContent = sub;
    card.appendChild(subEl);
  }

  parent.appendChild(card);
}
