// Reddit fetches per day — one bar per calendar day in the last 30 days,
// height = total fetches that day (summed across endpoints). Each
// investigation typically issues several fetches, so this is denser than
// the LLM requests-per-day chart.

import uPlot from "uplot";

import type { AnalyticsEntry } from "./logic.ts";
import { formatDayTick } from "./tick_helpers.ts";
import {
  bonAnalyticsAxes,
  bonAnalyticsEmptyPanel,
  bonAnalyticsPlaceTooltip,
  bonAnalyticsUplotHost,
  bonAnalyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

const MS_PER_DAY = 86_400_000;

export function bonAnalyticsRedditRequestsChart(
  runs: AnalyticsEntry[]
): HTMLElement {
  const samples = runs.filter(
    (run): run is AnalyticsEntry & { runAt: number } =>
      run.runAt != null && !!run.redditMetrics
  );

  if (!samples.length) {
    return bonAnalyticsEmptyPanel("No Reddit fetch data yet.");
  }

  const buckets = new Map<number, { fetches: number; errors: number }>();
  let earliest = Infinity;

  for (const sample of samples) {
    const day = new Date(sample.runAt);
    day.setHours(0, 0, 0, 0);
    const ts = day.getTime();
    earliest = Math.min(earliest, ts);
    const bucket = buckets.get(ts) || { fetches: 0, errors: 0 };

    for (const fetch of sample.redditMetrics?.fetches || []) {
      bucket.fetches++;
      if (fetch.status === "error") {
        bucket.errors++;
      }
    }

    buckets.set(ts, bucket);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const startTs = Math.max(earliest, todayTs - 30 * MS_PER_DAY);
  const totalDays = Math.round((todayTs - startTs) / MS_PER_DAY) + 1;

  const xs: number[] = new Array(totalDays);
  const counts: Array<number | null> = new Array(totalDays);
  const errs: number[] = new Array(totalDays);

  for (let i = 0; i < totalDays; i++) {
    const dayTs = startTs + i * MS_PER_DAY;
    const bucket = buckets.get(dayTs);
    xs[i] = Math.round(dayTs / 1000);
    counts[i] = bucket && bucket.fetches > 0 ? bucket.fetches : null;
    errs[i] = bucket?.errors ?? 0;
  }

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const data: uPlot.AlignedData = [xs, counts];
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
      y: { range: (_u, _min, max) => [0, Math.max(1, Math.ceil(max))] },
    },
    series: [
      {},
      {
        stroke: palette.forest,
        fill: palette.forest,
        width: 0,
        paths: uPlot.paths.bars!({ size: [barWidth, 32] }),
        points: { show: false },
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      xIncrs: [86400],
      xValues: (_u, splits) => splits.map(formatDayTick),
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

          if (idx == null || left < 0 || top < 0 || !counts[idx]) {
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
          row1.innerHTML = `<span>fetches</span><span>${count}</span>`;
          tooltip.appendChild(row1);

          if (errs[idx] > 0) {
            const row2 = document.createElement("div");
            row2.className = "bon-analytics-uplot-tooltip__row";
            row2.innerHTML = `<span>errors</span><span>${errs[idx]}</span>`;
            tooltip.appendChild(row2);
          }

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
