// Daily-activity bar chart — one bar per calendar day in the last 30 days,
// height = number of runs that day, tooltip shows the day's spend.

import uPlot from "uplot";

import { bonFmtUsd } from "../../utils/format_number.ts";
import type { AnalyticsEntry } from "./logic.ts";
import {
  bonAnalyticsAxes,
  bonAnalyticsEmptyPanel,
  bonAnalyticsPlaceTooltip,
  bonAnalyticsUplotHost,
  bonAnalyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

const MS_PER_DAY = 86_400_000;

export function bonAnalyticsActivityChart(runs: AnalyticsEntry[]): HTMLElement {
  const runsWithTime = runs.filter(
    (run): run is AnalyticsEntry & { runAt: number } => run.runAt != null
  );

  if (!runsWithTime.length) {
    return bonAnalyticsEmptyPanel("No timestamped runs to plot.");
  }

  const buckets = new Map<number, { count: number; cost: number }>();
  let earliest = Infinity;

  for (const run of runsWithTime) {
    const day = new Date(run.runAt);
    day.setHours(0, 0, 0, 0);
    const timestamp = day.getTime();
    earliest = Math.min(earliest, timestamp);
    const bucket = buckets.get(timestamp) || { count: 0, cost: 0 };
    bucket.count++;
    bucket.cost += run.totalCost;
    buckets.set(timestamp, bucket);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const maxSpan = 30 * MS_PER_DAY;
  const startTs = Math.max(earliest, todayTs - maxSpan);
  const totalDays = Math.round((todayTs - startTs) / MS_PER_DAY) + 1;

  const xs: number[] = new Array(totalDays);
  const counts: Array<number | null> = new Array(totalDays);
  const costs: number[] = new Array(totalDays);

  for (let i = 0; i < totalDays; i++) {
    const dayTs = startTs + i * MS_PER_DAY;
    const bucket = buckets.get(dayTs);
    xs[i] = Math.round(dayTs / 1000);
    counts[i] = bucket ? bucket.count : null;
    costs[i] = bucket ? bucket.cost : 0;
  }

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const data: uPlot.AlignedData = [xs, counts];

  // Bar widths: scale so a 30-day chart yields ~70% fill per day cell. For
  // shorter ranges keep bars slim so single-run days don't dominate.
  const barWidth = Math.max(0.45, Math.min(0.85, 0.9 - totalDays * 0.005));

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { show: false },
      focus: { prox: 24 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(1, Math.ceil(max))] },
    },
    series: [
      {},
      {
        stroke: palette.accent,
        fill: palette.accent,
        width: 0,
        paths: uPlot.paths.bars!({ size: [barWidth, 32] }),
        points: { show: false },
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      yValues: (_u, splits) =>
        splits.map((value) =>
          Number.isInteger(value) ? String(value) : value.toFixed(0)
        ),
    }),
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;

          if (
            idx == null ||
            left < 0 ||
            top < 0 ||
            counts[idx] == null ||
            counts[idx] === 0
          ) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const count = counts[idx] as number;
          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = new Date(xs[idx] * 1000).toLocaleDateString();
          tooltip.appendChild(head);

          const row1 = document.createElement("div");
          row1.className = "bon-analytics-uplot-tooltip__row";
          row1.innerHTML = `<span>runs</span><span>${count}</span>`;
          tooltip.appendChild(row1);

          const row2 = document.createElement("div");
          row2.className = "bon-analytics-uplot-tooltip__row";
          row2.innerHTML = `<span>spend</span><span>${bonFmtUsd(costs[idx])}</span>`;
          tooltip.appendChild(row2);

          tooltip.hidden = false;
          bonAnalyticsPlaceTooltip(
            host,
            tooltip,
            u.over.offsetLeft,
            u.over.offsetTop,
            left,
            top
          );
        },
      ],
    },
  };

  mount(opts, data);
  return host;
}
