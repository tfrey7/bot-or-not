// Top 10 most expensive individual investigations, rendered as a ranked
// list with a proportional bar to make the long-tail visually obvious.

import { bonFmtUsd } from "../../utils/format_number.js";
import { bonFmtDuration } from "../../utils/format_time.js";

export function bonAnalyticsTopSpenders(runs) {
  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-table-card";
  const title = document.createElement("h3");
  title.className = "bon-analytics-section-title";
  title.textContent = "Most expensive investigations";
  wrap.appendChild(title);

  const top = [...runs]
    .filter((r) => r.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10);
  if (!top.length) {
    const p = document.createElement("p");
    p.className = "bon-analytics-empty-small";
    p.textContent = "No cost data on the completed investigations.";
    wrap.appendChild(p);
    return wrap;
  }

  const maxCost = top[0].totalCost;
  const list = document.createElement("ol");
  list.className = "bon-analytics-top-list";
  for (const r of top) {
    const li = document.createElement("li");

    const name = document.createElement("a");
    name.className = "bon-analytics-top-name";
    name.href = `https://www.reddit.com/user/${encodeURIComponent(r.username)}`;
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.textContent = `u/${r.username}`;
    li.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "bon-analytics-top-meta";
    const metaBits = [];
    if (r.verdict) {
      metaBits.push(r.verdict.replace(/-/g, " "));
    }
    if (r.durationMs != null) {
      metaBits.push(bonFmtDuration(r.durationMs));
    }
    metaBits.push(`${r.calls.length} call${r.calls.length === 1 ? "" : "s"}`);
    if (r.runAt) {
      metaBits.push(new Date(r.runAt).toLocaleDateString());
    }
    meta.textContent = metaBits.join(" · ");
    li.appendChild(meta);

    const bar = document.createElement("div");
    bar.className = "bon-analytics-top-bar";
    const fill = document.createElement("div");
    fill.className = "bon-analytics-top-bar-fill";
    fill.style.width = `${(r.totalCost / maxCost) * 100}%`;
    bar.appendChild(fill);
    li.appendChild(bar);

    const cost = document.createElement("span");
    cost.className = "bon-analytics-top-cost";
    cost.textContent = bonFmtUsd(r.totalCost);
    li.appendChild(cost);

    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}
