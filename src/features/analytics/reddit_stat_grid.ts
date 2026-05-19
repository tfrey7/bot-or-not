// Stat tiles summarizing Reddit-side performance across all investigations
// that captured fetch metrics. Sits at the top of the "Reddit performance"
// section, mirroring the Claude-side stat grid above the chart row.

import { bonFmtPercent, bonFmtThousands } from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import type { AnalyticsRedditSummary } from "./logic.ts";

export function bonAnalyticsRedditStatGrid(
  reddit: AnalyticsRedditSummary
): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = "bon-analytics-stats";

  addStat(
    grid,
    "Runs measured",
    bonFmtThousands(reddit.runsWithMetrics),
    `${bonFmtThousands(reddit.totalFetches)} total fetches`
  );
  addStat(
    grid,
    "Avg wall clock",
    bonFmtDuration(reddit.avgWallClockMs),
    `median ${bonFmtDuration(reddit.medianWallClockMs)} · p95 ${bonFmtDuration(reddit.p95WallClockMs)}`
  );
  addStat(
    grid,
    "Fetch error rate",
    bonFmtPercent(reddit.errorRate, reddit.errorRate < 0.1 ? 1 : 0),
    reddit.totalErrors > 0
      ? `${bonFmtThousands(reddit.totalErrors)} failed of ${bonFmtThousands(reddit.totalFetches)}`
      : "no fetch errors recorded"
  );

  const listingEndpoints = reddit.endpoints.filter(
    (entry) => entry.itemSamples > 0
  );
  const totalListingItems = listingEndpoints.reduce(
    (acc, entry) => acc + entry.totalItems,
    0
  );
  const totalListingSamples = listingEndpoints.reduce(
    (acc, entry) => acc + entry.itemSamples,
    0
  );
  addStat(
    grid,
    "Avg payload",
    totalListingSamples
      ? `${(totalListingItems / totalListingSamples).toFixed(1)}`
      : "—",
    "items per listing fetch (cap 100)"
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
