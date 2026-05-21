// Duration histogram — categorical x-axis with seven fixed buckets ("<15s",
// "15–30s", …, "3m+"), bar height = run count, dashed vertical line marks the
// median's bucket.

import uPlot from "uplot";

import { bonFmtPercent } from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonPercentile } from "../../utils/stats.ts";
import type { AnalyticsEntry } from "./logic.ts";
import {
  bonAnalyticsAxes,
  bonAnalyticsEmptyPanel,
  bonAnalyticsPlaceTooltip,
  bonAnalyticsUplotHost,
  bonAnalyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

const BUCKETS: Array<{ label: string; max: number }> = [
  { label: "<15s", max: 15_000 },
  { label: "15–30s", max: 30_000 },
  { label: "30–60s", max: 60_000 },
  { label: "1–1.5m", max: 90_000 },
  { label: "1.5–2m", max: 120_000 },
  { label: "2–3m", max: 180_000 },
  { label: "3m+", max: Infinity },
];

function bucketFor(durationMs: number): number {
  const idx = BUCKETS.findIndex((bucket) => durationMs < bucket.max);
  return idx === -1 ? BUCKETS.length - 1 : idx;
}

export function bonAnalyticsDurationChart(runs: AnalyticsEntry[]): HTMLElement {
  const durations = runs
    .map((run) => run.durationMs)
    .filter((duration): duration is number => typeof duration === "number");

  if (!durations.length) {
    return bonAnalyticsEmptyPanel("No duration data.");
  }

  const counts: Array<number | null> = new Array(BUCKETS.length).fill(0);

  for (const duration of durations) {
    const idx = bucketFor(duration);
    counts[idx] = (counts[idx] as number) + 1;
  }

  // Force null for empty buckets so the bars plugin skips them (no zero-height
  // stub painted at the axis).
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0) {
      counts[i] = null;
    }
  }

  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianMs = bonPercentile(sortedDurations, 0.5);
  const medianBucket = bucketFor(medianMs);

  const xs = BUCKETS.map((_, i) => i);

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const data: uPlot.AlignedData = [xs, counts];

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { show: false },
      focus: { prox: 28 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      x: {
        time: false,
        range: () => [-0.5, BUCKETS.length - 0.5],
      },
      y: { range: (_u, _min, max) => [0, Math.max(1, Math.ceil(max))] },
    },
    series: [
      {},
      {
        stroke: palette.forest,
        fill: palette.forest,
        width: 0,
        paths: uPlot.paths.bars!({ size: [0.78, 32] }),
        points: { show: false },
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      xValues: (_u, splits) =>
        splits.map((value) => {
          const idx = Math.round(value);
          return BUCKETS[idx]?.label ?? "";
        }),
      yValues: (_u, splits) =>
        splits.map((value) =>
          Number.isInteger(value) ? String(value) : value.toFixed(0)
        ),
    }),
    hooks: {
      // Vertical dashed line marking the median's bucket. Drawn after the
      // bars so it sits on top.
      draw: [
        (u) => {
          const x = u.valToPos(medianBucket, "x", true);
          const ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = palette.red;
          ctx.lineWidth = 1 * uPlot.pxRatio;
          ctx.setLineDash([3 * uPlot.pxRatio, 3 * uPlot.pxRatio]);
          ctx.beginPath();
          ctx.moveTo(x, u.bbox.top);
          ctx.lineTo(x, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        },
      ],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;
          const value = idx != null ? counts[idx] : null;

          if (idx == null || left < 0 || top < 0 || value == null) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = BUCKETS[idx].label;
          tooltip.appendChild(head);

          const row1 = document.createElement("div");
          row1.className = "bon-analytics-uplot-tooltip__row";
          row1.innerHTML = `<span>runs</span><span>${value}</span>`;
          tooltip.appendChild(row1);

          const row2 = document.createElement("div");
          row2.className = "bon-analytics-uplot-tooltip__row";
          row2.innerHTML = `<span>share</span><span>${bonFmtPercent(value / durations.length)}</span>`;
          tooltip.appendChild(row2);

          if (idx === medianBucket) {
            const flag = document.createElement("div");
            flag.className = "bon-analytics-uplot-tooltip__flag";
            flag.textContent = `Median run: ${bonFmtDuration(medianMs)}`;
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
