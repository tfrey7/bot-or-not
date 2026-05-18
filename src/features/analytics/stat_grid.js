// Top-of-page stat grid — 8 summary tiles (total spend, recent burn rate,
// API calls, tokens, durations, cache savings, Reddit items, cost/item).

import {
  bonFmtPercent,
  bonFmtThousands,
  bonFmtUsd,
} from "../../utils/format_number.js";
import { bonFmtDuration } from "../../utils/format_time.js";

export function bonAnalyticsStatGrid(s) {
  const grid = document.createElement("div");
  grid.className = "bon-analytics-stats";

  addStat(
    grid,
    "Total spent",
    bonFmtUsd(s.totalCost),
    `${bonFmtUsd(s.avgCost)} avg · ${bonFmtUsd(s.medianCost)} median · ${bonFmtUsd(s.maxCost)} max`
  );
  addStat(
    grid,
    "Spend last 7d",
    bonFmtUsd(s.recentCost),
    s.recentCost > 0
      ? `~${bonFmtUsd(s.recentCost / s.recentDays)} / day`
      : "no activity this week"
  );
  addStat(
    grid,
    "API requests",
    String(s.totalApiCalls + s.totalWebSearches),
    `${s.totalApiCalls} Claude · ${s.totalWebSearches} web search`
  );
  addStat(
    grid,
    "Total tokens",
    bonFmtThousands(s.totalTokens),
    `${bonFmtThousands(s.totalOutput)} output · ${bonFmtPercent(s.cacheHitRate)} cached`
  );
  addStat(
    grid,
    "Median duration",
    bonFmtDuration(s.medianDuration),
    `p95 ${bonFmtDuration(s.p95Duration)} · ${bonFmtDuration(s.totalDuration)} total compute`
  );
  addStat(
    grid,
    "Cache savings",
    bonFmtUsd(s.cacheSavingsUsd),
    "vs. paying full input rate on cached reads"
  );
  addStat(
    grid,
    "Reddit fetched",
    bonFmtThousands(s.totalPosts + s.totalComments),
    `${bonFmtThousands(s.totalPosts)} posts · ${bonFmtThousands(s.totalComments)} comments`
  );
  addStat(
    grid,
    "Cost per Reddit item",
    s.totalPosts + s.totalComments > 0
      ? bonFmtUsd(s.totalCost / (s.totalPosts + s.totalComments))
      : "—",
    "post/comment analyzed"
  );

  return grid;
}

function addStat(parent, label, value, sub) {
  const card = document.createElement("div");
  card.className = "bon-analytics-stat";
  const l = document.createElement("div");
  l.className = "bon-stat-label";
  l.textContent = label;
  const v = document.createElement("div");
  v.className = "bon-stat-value";
  v.textContent = value;
  card.appendChild(l);
  card.appendChild(v);
  if (sub) {
    const sb = document.createElement("div");
    sb.className = "bon-stat-sub";
    sb.textContent = sub;
    card.appendChild(sb);
  }
  parent.appendChild(card);
}
