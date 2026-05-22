// Top 10 most expensive individual investigations, rendered as a ranked
// list with a proportional bar to make the long-tail visually obvious.

import { bonFmtUsd } from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import type { AnalyticsEntry } from "./logic.ts";

export function bonAnalyticsTopSpenders(
  runs: AnalyticsEntry[]
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-table-card";

  const title = document.createElement("h3");
  title.className = "bon-analytics-section-title";
  title.textContent = "Most expensive investigations";
  wrap.appendChild(title);

  const top = [...runs]
    .filter((run) => run.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10);

  if (!top.length) {
    const emptyMsg = document.createElement("p");
    emptyMsg.className = "bon-analytics-empty-small";
    emptyMsg.textContent = "No cost data on the completed investigations.";
    wrap.appendChild(emptyMsg);
    return wrap;
  }

  const maxCost = top[0].totalCost;
  const list = document.createElement("ol");
  list.className = "bon-analytics-top-list";

  for (const run of top) {
    const li = document.createElement("li");

    const name = document.createElement("a");
    name.className = "bon-analytics-top-name";
    name.href = `?user=${encodeURIComponent(run.username)}`;
    name.textContent = `u/${run.username}`;
    li.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "bon-analytics-top-meta";
    const metaBits: string[] = [];

    if (run.verdict) {
      metaBits.push(run.verdict.replace(/-/g, " "));
    }

    if (run.durationMs != null) {
      metaBits.push(bonFmtDuration(run.durationMs));
    }

    metaBits.push(
      `${run.calls.length} call${run.calls.length === 1 ? "" : "s"}`
    );

    if (run.runAt) {
      metaBits.push(new Date(run.runAt).toLocaleDateString());
    }

    meta.textContent = metaBits.join(" · ");
    li.appendChild(meta);

    const bar = document.createElement("div");
    bar.className = "bon-analytics-top-bar";
    const fill = document.createElement("div");
    fill.className = "bon-analytics-top-bar-fill";
    fill.style.width = `${(run.totalCost / maxCost) * 100}%`;
    bar.appendChild(fill);
    li.appendChild(bar);

    const cost = document.createElement("span");
    cost.className = "bon-analytics-top-cost";
    cost.textContent = bonFmtUsd(run.totalCost);
    li.appendChild(cost);

    list.appendChild(li);
  }

  wrap.appendChild(list);
  return wrap;
}
