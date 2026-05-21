// Per-endpoint timing chart. One categorical column per Reddit endpoint;
// bar height = median duration, a marker above each bar = p95. Endpoints with
// errors get a rust-colored dot above the p95 marker so a struggling endpoint
// is visible at a glance; the tooltip carries the full breakdown.

import uPlot from "uplot";

import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonPercentile } from "../../utils/stats.ts";
import type { AnalyticsRedditSummary } from "./logic.ts";
import {
  bonAnalyticsAxes,
  bonAnalyticsEmptyPanel,
  bonAnalyticsPlaceTooltip,
  bonAnalyticsUplotHost,
  bonAnalyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

interface EndpointStat {
  endpoint: string;
  fetches: number;
  errors: number;
  median: number;
  p95: number;
  max: number;
}

export function bonAnalyticsRedditEndpointTimingChart(
  reddit: AnalyticsRedditSummary
): HTMLElement {
  const stats: EndpointStat[] = reddit.endpoints.map((bucket) => {
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    return {
      endpoint: bucket.endpoint,
      fetches: bucket.fetches,
      errors: bucket.errors,
      median: bonPercentile(sorted, 0.5),
      p95: bonPercentile(sorted, 0.95),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
    };
  });

  if (!stats.some((stat) => stat.fetches > 0)) {
    return bonAnalyticsEmptyPanel("No fetch metrics yet.");
  }

  const xs = stats.map((_, i) => i);
  const medians: Array<number | null> = stats.map((stat) =>
    stat.fetches > 0 ? stat.median : null
  );
  const p95s: Array<number | null> = stats.map((stat) =>
    stat.fetches > 0 ? stat.p95 : null
  );

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const data: uPlot.AlignedData = [xs, medians, p95s];

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { show: false },
      focus: { prox: 36 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      x: {
        time: false,
        range: () => [-0.5, stats.length - 0.5],
      },
      y: { range: (_u, _min, max) => [0, Math.max(1, max)] },
    },
    series: [
      {},
      {
        stroke: palette.forest,
        fill: palette.forest,
        width: 0,
        paths: uPlot.paths.bars!({ size: [0.6, 32] }),
        points: { show: false },
      },
      {
        stroke: palette.red,
        width: 0,
        paths: () => null,
        points: {
          show: true,
          size: 7,
          stroke: palette.surface,
          fill: palette.red,
          width: 1.25,
        },
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      xValues: (_u, splits) =>
        splits.map((value) => {
          const idx = Math.round(value);
          return stats[idx]?.endpoint ?? "";
        }),
      yValues: (_u, splits) =>
        splits.map((value) => bonFmtDuration(Math.max(0, value))),
    }),
    hooks: {
      // Rust dot above the p95 marker for endpoints with errors.
      draw: [
        (u) => {
          const ctx = u.ctx;
          ctx.save();
          ctx.fillStyle = palette.rust;
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = 1.25 * uPlot.pxRatio;

          stats.forEach((stat, i) => {
            if (stat.errors === 0 || stat.fetches === 0) {
              return;
            }

            const x = u.valToPos(i, "x", true);
            const y = u.valToPos(stat.p95, "y", true) - 12 * uPlot.pxRatio;
            ctx.beginPath();
            ctx.arc(x, y, 3.5 * uPlot.pxRatio, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });

          ctx.restore();
        },
      ],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;
          const stat = idx != null ? stats[idx] : null;

          if (
            idx == null ||
            left < 0 ||
            top < 0 ||
            !stat ||
            stat.fetches === 0
          ) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = stat.endpoint;
          tooltip.appendChild(head);

          const sub = document.createElement("div");
          sub.className = "bon-analytics-uplot-tooltip__sub";
          sub.textContent = `${stat.fetches} fetch${stat.fetches === 1 ? "" : "es"}`;
          tooltip.appendChild(sub);

          const median = document.createElement("div");
          median.className = "bon-analytics-uplot-tooltip__row";
          median.innerHTML = `<span>median</span><span>${bonFmtDuration(stat.median)}</span>`;
          tooltip.appendChild(median);

          const p95 = document.createElement("div");
          p95.className = "bon-analytics-uplot-tooltip__row";
          p95.innerHTML = `<span>p95</span><span>${bonFmtDuration(stat.p95)}</span>`;
          tooltip.appendChild(p95);

          const max = document.createElement("div");
          max.className = "bon-analytics-uplot-tooltip__row";
          max.innerHTML = `<span>max</span><span>${bonFmtDuration(stat.max)}</span>`;
          tooltip.appendChild(max);

          if (stat.errors > 0) {
            const flag = document.createElement("div");
            flag.className =
              "bon-analytics-uplot-tooltip__flag bon-analytics-uplot-tooltip__flag--error";
            flag.textContent = `${stat.errors} error${stat.errors === 1 ? "" : "s"}`;
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
