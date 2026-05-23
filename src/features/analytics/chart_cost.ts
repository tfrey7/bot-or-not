// Cumulative-spend line chart. Plots the running total of run cost over time;
// the single most-expensive run is highlighted with a marker drawn on top of
// the line, and hovering anywhere along the line surfaces a tooltip with that
// run's u/name, individual cost, and the cumulative-so-far.

import uPlot from "uplot";

import { bonFmtUsd } from "../../utils/format_number.ts";
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

interface CostPoint {
  ts: number;
  cumulative: number;
  cost: number;
  username: string;
}

export function bonAnalyticsCostChart(runs: AnalyticsEntry[]): HTMLElement {
  const sorted = runs
    .filter(
      (run): run is AnalyticsEntry & { runAt: number } => run.runAt != null
    )
    .sort((a, b) => a.runAt - b.runAt);

  if (!sorted.length) {
    return bonAnalyticsEmptyPanel("No timestamped runs to plot.");
  }

  const points: CostPoint[] = [];
  let cumulative = 0;

  for (const run of sorted) {
    cumulative += run.totalCost;
    points.push({
      ts: Math.round(run.runAt / 1000),
      cumulative,
      cost: run.totalCost,
      username: run.username,
    });
  }

  // Highlight the single most expensive run.
  let maxIndex = 0;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].totalCost > sorted[maxIndex].totalCost) {
      maxIndex = i;
    }
  }

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const xs = points.map((point) => point.ts);
  const ys = points.map((point) => point.cumulative);

  // Single-run charts are pathological for uplot's autoscale (zero x-range);
  // pad ±30s so the lone point renders centered with axis labels.
  if (xs.length === 1) {
    xs.unshift(xs[0] - 30);
    xs.push(xs[xs.length - 1] + 30);
    ys.unshift(NaN);
    ys.push(NaN);
  }

  const data: uPlot.AlignedData = [xs, ys];

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { size: 7 },
      focus: { prox: 24 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(max, 0.0001)] },
    },
    series: [
      {},
      {
        stroke: palette.accent,
        width: 1.75,
        fill: palette.accentSoft,
        points: { show: false },
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      xIncrs: [86400],
      xValues: (_u, splits) => splits.map(formatDayTick),
      yValues: (_u, splits) => splits.map((value) => bonFmtUsd(value)),
    }),
    hooks: {
      draw: [
        (u) => {
          // Draw the "most expensive" marker on the actual data point in
          // axis coords. drawn here (after series) so it sits on top.
          const sourceIdx = xs.length === ys.length ? maxIndex : maxIndex + 1;
          const x = u.valToPos(xs[sourceIdx], "x", true);
          const y = u.valToPos(ys[sourceIdx], "y", true);
          const ctx = u.ctx;
          ctx.save();
          ctx.fillStyle = palette.rust;
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = 1.5 * uPlot.pxRatio;
          ctx.beginPath();
          ctx.arc(x, y, 4 * uPlot.pxRatio, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      ],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          const left = u.cursor.left ?? -1;
          const top = u.cursor.top ?? -1;

          if (idx == null || left < 0 || top < 0) {
            tooltip.hidden = true;
            return;
          }

          // Skip the synthetic padding points used for single-run charts.
          const yVal = ys[idx];
          if (!Number.isFinite(yVal)) {
            tooltip.hidden = true;
            return;
          }

          const sourceIdx = xs.length === points.length ? idx : idx - 1;
          const point = points[sourceIdx];

          if (!point) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const headline = document.createElement("div");
          headline.className = "bon-analytics-uplot-tooltip__head bon-pii-name";
          headline.textContent = `u/${point.username}`;
          tooltip.appendChild(headline);

          const when = document.createElement("div");
          when.className = "bon-analytics-uplot-tooltip__sub";
          when.textContent = new Date(point.ts * 1000).toLocaleString();
          tooltip.appendChild(when);

          const thisRun = document.createElement("div");
          thisRun.className = "bon-analytics-uplot-tooltip__row";
          thisRun.innerHTML = `<span>this run</span><span>${bonFmtUsd(point.cost)}</span>`;
          tooltip.appendChild(thisRun);

          const cum = document.createElement("div");
          cum.className = "bon-analytics-uplot-tooltip__row";
          cum.innerHTML = `<span>cumulative</span><span>${bonFmtUsd(point.cumulative)}</span>`;
          tooltip.appendChild(cum);

          if (sourceIdx === maxIndex) {
            const flag = document.createElement("div");
            flag.className = "bon-analytics-uplot-tooltip__flag";
            flag.textContent = "Most expensive run";
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
