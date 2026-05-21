// Wall-clock Reddit fetch duration per investigation, plotted in run order.
// Two overlaid series so the OK and error points can be styled distinctly,
// while a single connecting line in the background shows trend.

import uPlot from "uplot";

import { bonFmtDuration } from "../../utils/format_time.ts";
import type { AnalyticsEntry } from "./logic.ts";
import { bonAnalyticsRedditFetchTimeline } from "./logic.ts";
import {
  bonAnalyticsAxes,
  bonAnalyticsEmptyPanel,
  bonAnalyticsPlaceTooltip,
  bonAnalyticsUplotHost,
  bonAnalyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

export function bonAnalyticsRedditDurationChart(
  runs: AnalyticsEntry[]
): HTMLElement {
  const points = bonAnalyticsRedditFetchTimeline(runs);

  if (!points.length) {
    return bonAnalyticsEmptyPanel("No Reddit fetch timing data yet.");
  }

  const xs: number[] = [];
  const okSeries: Array<number | null> = [];
  const errorSeries: Array<number | null> = [];

  for (const point of points) {
    xs.push(Math.round(point.runAt / 1000));
    if (point.hadError) {
      okSeries.push(null);
      errorSeries.push(point.totalDurationMs);
    } else {
      okSeries.push(point.totalDurationMs);
      errorSeries.push(null);
    }
  }

  // Single-point case: synthesize padding so the time axis renders cleanly.
  let basePadding = false;

  if (xs.length === 1) {
    xs.unshift(xs[0] - 30);
    xs.push(xs[xs.length - 1] + 30);
    okSeries.unshift(null);
    okSeries.push(null);
    errorSeries.unshift(null);
    errorSeries.push(null);
    basePadding = true;
  }

  // Connecting line — render all points (regardless of error) so trend is
  // visible. Drawn as a series with no points, just a stroke.
  const lineSeries: Array<number | null> = xs.map((_, i) => {
    const ok = okSeries[i];
    const err = errorSeries[i];
    if (ok != null) {
      return ok;
    }

    if (err != null) {
      return err;
    }

    return null;
  });

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const data: uPlot.AlignedData = [xs, lineSeries, okSeries, errorSeries];

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { size: 7 },
      focus: { prox: 24 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(max, 1)] },
    },
    series: [
      {},
      {
        stroke: palette.accent,
        width: 1.5,
        points: { show: false },
        spanGaps: true,
      },
      {
        stroke: palette.accent,
        fill: palette.accent,
        width: 0,
        paths: () => null,
        points: {
          show: true,
          size: 6,
          fill: palette.accent,
          stroke: palette.surface,
          width: 1.25,
        },
      },
      {
        stroke: palette.rust,
        fill: palette.rust,
        width: 0,
        paths: () => null,
        points: {
          show: true,
          size: 8,
          fill: palette.rust,
          stroke: palette.surface,
          width: 1.5,
        },
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      yValues: (_u, splits) =>
        splits.map((value) => bonFmtDuration(Math.max(0, value))),
    }),
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;

          if (idx == null || left < 0 || top < 0) {
            tooltip.hidden = true;
            return;
          }

          const value = lineSeries[idx];
          if (value == null) {
            tooltip.hidden = true;
            return;
          }

          // Map back to original points[] index.
          const sourceIdx = basePadding ? idx - 1 : idx;
          const point = points[sourceIdx];

          if (!point) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = new Date(point.runAt).toLocaleString();
          tooltip.appendChild(head);

          const row = document.createElement("div");
          row.className = "bon-analytics-uplot-tooltip__row";
          row.innerHTML = `<span>wall clock</span><span>${bonFmtDuration(point.totalDurationMs)}</span>`;
          tooltip.appendChild(row);

          if (point.hadError) {
            const flag = document.createElement("div");
            flag.className =
              "bon-analytics-uplot-tooltip__flag bon-analytics-uplot-tooltip__flag--error";
            flag.textContent = "Fetch error";
            tooltip.appendChild(flag);
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
