// Detailed per-endpoint table — exact numbers behind the timing chart.
// Includes the HTTP-status breakdown for any errors so a 429 spike vs.
// a 503 spike is distinguishable at a glance.

import { bonFmtPercent, bonFmtThousands } from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonPercentile } from "../../utils/stats.ts";
import type { AnalyticsRedditSummary } from "./logic.ts";

export function bonAnalyticsRedditEndpointsTable(
  reddit: AnalyticsRedditSummary
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-table-card";

  const title = document.createElement("h3");
  title.className = "bon-analytics-section-title";
  title.textContent = "Per-endpoint breakdown";
  wrap.appendChild(title);

  if (!reddit.endpoints.some((entry) => entry.fetches > 0)) {
    const empty = document.createElement("p");
    empty.className = "bon-analytics-empty-small";
    empty.textContent = "Run an investigation to populate Reddit fetch stats.";
    wrap.appendChild(empty);
    return wrap;
  }

  const table = document.createElement("table");
  table.className = "bon-analytics-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  [
    { label: "Endpoint", align: "left" as const },
    { label: "Fetches" },
    { label: "Errors" },
    { label: "Error rate" },
    { label: "Avg" },
    { label: "Median" },
    { label: "p95" },
    { label: "Max" },
    { label: "Avg payload" },
    { label: "Error codes", align: "left" as const },
  ].forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column.label;
    if (column.align) {
      th.style.textAlign = column.align;
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const entry of reddit.endpoints) {
    const tr = document.createElement("tr");
    const sorted = [...entry.durations].sort((a, b) => a - b);
    const avg = entry.fetches ? entry.totalDurationMs / entry.fetches : null;
    const median = sorted.length ? bonPercentile(sorted, 0.5) : null;
    const p95 = sorted.length ? bonPercentile(sorted, 0.95) : null;
    const max = sorted.length ? sorted[sorted.length - 1] : null;
    const errorRate = entry.fetches ? entry.errors / entry.fetches : 0;
    const avgPayload = entry.itemSamples
      ? entry.totalItems / entry.itemSamples
      : null;

    const tdEndpoint = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = entry.endpoint;
    tdEndpoint.appendChild(code);
    tr.appendChild(tdEndpoint);

    const errorBreakdown = Object.entries(entry.errorStatuses)
      .sort(([, a], [, b]) => b - a)
      .map(([status, count]) => `${status} ×${count}`)
      .join(", ");

    [
      bonFmtThousands(entry.fetches),
      entry.errors > 0 ? bonFmtThousands(entry.errors) : "—",
      entry.fetches > 0
        ? bonFmtPercent(errorRate, errorRate < 0.1 ? 1 : 0)
        : "—",
      bonFmtDuration(avg),
      bonFmtDuration(median),
      bonFmtDuration(p95),
      bonFmtDuration(max),
      avgPayload !== null ? avgPayload.toFixed(1) : "—",
    ].forEach((cellText) => {
      const td = document.createElement("td");
      td.textContent = cellText;
      tr.appendChild(td);
    });

    const tdErrors = document.createElement("td");
    tdErrors.style.textAlign = "left";
    tdErrors.textContent = errorBreakdown || "—";
    tr.appendChild(tdErrors);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const scroll = document.createElement("div");
  scroll.className = "bon-analytics-table-scroll";
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}
