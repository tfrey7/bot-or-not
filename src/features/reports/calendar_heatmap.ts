// GitHub-style 53-week activity heatmap. Cells before the API window
// boundary (Reddit only returns the most recent 100 posts/comments) get a
// muted "unknown" style so the visualization doesn't lie about dormancy
// in the older history we can't see.

import type { ActivityData } from "../../types.ts";
import { bonBucketLevel } from "../../utils/scoring.ts";
import { BON_REPORTS_DAY_NAMES, BON_REPORTS_MONTH_NAMES } from "./data.ts";
import { bonReportsComputeEarliestFullyVisible } from "./logic.ts";

export function bonReportsCalendarHeatmap(
  timestamps: number[],
  activityData: ActivityData
): HTMLDivElement {
  const earliestVisible = bonReportsComputeEarliestFullyVisible(activityData);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const currentWeekSunday = new Date(today);
  currentWeekSunday.setDate(today.getDate() - today.getDay());

  const startSunday = new Date(currentWeekSunday);
  startSunday.setDate(currentWeekSunday.getDate() - 52 * 7);

  const dayKey = (date: Date): string =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  const counts = new Map<string, number>();

  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    const key = dayKey(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-cal";

  const dayLabels = document.createElement("div");
  dayLabels.className = "bon-cal-days";

  for (let i = 0; i < 7; i++) {
    const label = document.createElement("div");

    // Show every other day label to reduce clutter
    label.textContent = i % 2 === 1 ? BON_REPORTS_DAY_NAMES[i] : "";
    dayLabels.appendChild(label);
  }

  wrap.appendChild(dayLabels);

  const right = document.createElement("div");
  right.className = "bon-cal-right";

  // Build month runs and only label months that span at least 3 weeks, so
  // the truncated first/last month doesn't visually crash into its neighbour.
  const monthRuns: Array<{ startWeek: number; month: number }> = [];
  let curMonth = -1;

  for (let w = 0; w < 53; w++) {
    const sunday = new Date(startSunday);
    sunday.setDate(startSunday.getDate() + w * 7);
    const month = sunday.getMonth();
    if (month !== curMonth) {
      monthRuns.push({ startWeek: w, month });
      curMonth = month;
    }
  }

  monthRuns.push({ startWeek: 53, month: -1 });

  const monthLabelByWeek = new Map<number, number>();

  for (let i = 0; i < monthRuns.length - 1; i++) {
    const length = monthRuns[i + 1].startWeek - monthRuns[i].startWeek;
    if (length >= 3) {
      monthLabelByWeek.set(monthRuns[i].startWeek, monthRuns[i].month);
    }
  }

  const months = document.createElement("div");
  months.className = "bon-cal-months";

  for (let w = 0; w < 53; w++) {
    const span = document.createElement("span");
    if (monthLabelByWeek.has(w)) {
      span.textContent = BON_REPORTS_MONTH_NAMES[monthLabelByWeek.get(w)!];
    }

    months.appendChild(span);
  }

  right.appendChild(months);

  const grid = document.createElement("div");
  grid.className = "bon-cal-grid";

  for (let w = 0; w < 53; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(startSunday);
      date.setDate(startSunday.getDate() + w * 7 + d);

      const cell = document.createElement("div");
      cell.className = "bon-cal-cell";

      if (date > today) {
        cell.classList.add("bon-cal-cell--future");
      } else {
        const count = counts.get(dayKey(date)) || 0;
        const level = bonBucketLevel(count);
        const inUnknownZone =
          earliestVisible && date.getTime() < earliestVisible && count === 0;

        if (inUnknownZone) {
          cell.classList.add("bon-cal-cell--unknown");
          cell.title = `${date.toLocaleDateString()} — beyond Reddit's API window (unknown)`;
        } else if (level > 0) {
          cell.classList.add(`bon-heatmap-cell--lvl${level}`);
          cell.title = `${date.toLocaleDateString()} — ${count} item${count === 1 ? "" : "s"}`;
        } else {
          cell.title = `${date.toLocaleDateString()} — no activity`;
        }
      }

      grid.appendChild(cell);
    }
  }

  right.appendChild(grid);

  wrap.appendChild(right);

  const legend = document.createElement("div");
  legend.className = "bon-heatmap-legend";
  legend.appendChild(document.createTextNode("Less"));

  for (let i = 0; i <= 5; i++) {
    const cell = document.createElement("span");
    cell.className = "bon-heatmap-legend-cell";
    if (i > 0) {
      cell.classList.add(`bon-heatmap-cell--lvl${i}`);
    }

    legend.appendChild(cell);
  }

  legend.appendChild(document.createTextNode("More"));

  const outer = document.createElement("div");
  outer.appendChild(wrap);
  outer.appendChild(legend);
  return outer;
}
