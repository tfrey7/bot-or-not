// Spend-per-day bar chart — one bar per calendar day in the last 30 days,
// height = that day's total run cost, tooltip shows the day's spend and run count.

import uPlot from "uplot";

import { fmtUsd } from "../../utils/format_number.ts";
import type { AnalyticsEntry } from "./logic.ts";
import { formatDayTick } from "./tick_helpers.ts";
import {
  analyticsAxes,
  analyticsEmptyPanel,
  analyticsPlaceTooltip,
  analyticsUplotHost,
  analyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

const MS_PER_DAY = 86_400_000;

export function analyticsCostChart(runs: AnalyticsEntry[]): HTMLElement {
  const runsWithTime = runs.filter(
    (run): run is AnalyticsEntry & { runAt: number } => run.runAt != null
  );

  if (!runsWithTime.length) {
    return analyticsEmptyPanel("No timestamped runs to plot.");
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
  const spends: Array<number | null> = new Array(totalDays);
  const counts: number[] = new Array(totalDays);

  for (let i = 0; i < totalDays; i++) {
    const dayTs = startTs + i * MS_PER_DAY;
    const bucket = buckets.get(dayTs);
    xs[i] = Math.round(dayTs / 1000);
    spends[i] = bucket ? bucket.cost : null;
    counts[i] = bucket ? bucket.count : 0;
  }

  const palette = analyticsUplotPalette();
  const { host, tooltip, mount } = analyticsUplotHost();

  const data: uPlot.AlignedData = [xs, spends];

  // Bar widths: scale so a 30-day chart yields ~70% fill per day cell. For
  // shorter ranges keep bars slim so single-spend days don't dominate.
  const barWidth = Math.max(0.45, Math.min(0.85, 0.9 - totalDays * 0.005));

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { show: false },
      focus: { prox: 24 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      // Pad ½ day on each side so the first/last bar isn't clipped by the
      // plot area (bars are centered on their data point and would
      // otherwise have their outer half cut off).
      x: {
        time: true,
        range: (_u, min, max) => [min - 43_200, max + 43_200],
      },
      y: { range: (_u, _min, max) => [0, Math.max(max, 0.0001)] },
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
    axes: analyticsAxes(palette, {
      xIncrs: [86400],
      xValues: (_u, splits) => splits.map(formatDayTick),
      yValues: (_u, splits) => splits.map((value) => fmtUsd(value)),
    }),
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;

          if (idx == null || left < 0 || top < 0 || spends[idx] == null) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = new Date(xs[idx] * 1000).toLocaleDateString();
          tooltip.appendChild(head);

          const spendRow = document.createElement("div");
          spendRow.className = "bon-analytics-uplot-tooltip__row";
          spendRow.innerHTML = `<span>spend</span><span>${fmtUsd(spends[idx] as number)}</span>`;
          tooltip.appendChild(spendRow);

          const runsRow = document.createElement("div");
          runsRow.className = "bon-analytics-uplot-tooltip__row";
          runsRow.innerHTML = `<span>runs</span><span>${counts[idx]}</span>`;
          tooltip.appendChild(runsRow);

          tooltip.hidden = false;
          analyticsPlaceTooltip(
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
