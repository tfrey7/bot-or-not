// Daily request latency — two lines, p50 and p95, computed from the
// durationMs of every investigation run that landed on that calendar day.
// Last 30 days, empty days plotted as gaps.

import uPlot from "uplot";

import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonPercentile } from "../../utils/stats.ts";
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

export function bonAnalyticsLatencyChart(runs: AnalyticsEntry[]): HTMLElement {
  const samples = runs.filter(
    (run): run is AnalyticsEntry & { runAt: number; durationMs: number } =>
      run.runAt != null && typeof run.durationMs === "number"
  );

  if (!samples.length) {
    return bonAnalyticsEmptyPanel("No latency data yet.");
  }

  return bonAnalyticsDailyLatencyChart(
    samples.map((run) => ({ runAt: run.runAt, durationMs: run.durationMs })),
    "request"
  );
}

interface LatencySample {
  runAt: number;
  durationMs: number;
}

// Shared body — used by both the LLM (per-investigation) and Reddit
// (per-fetch) latency charts. `noun` controls the tooltip label.
export function bonAnalyticsDailyLatencyChart(
  samples: LatencySample[],
  noun: string
): HTMLElement {
  const buckets = new Map<number, number[]>();
  let earliest = Infinity;

  for (const sample of samples) {
    const day = new Date(sample.runAt);
    day.setHours(0, 0, 0, 0);
    const ts = day.getTime();
    earliest = Math.min(earliest, ts);
    const bucket = buckets.get(ts) || [];
    bucket.push(sample.durationMs);
    buckets.set(ts, bucket);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const startTs = Math.max(earliest, todayTs - 30 * MS_PER_DAY);
  const totalDays = Math.round((todayTs - startTs) / MS_PER_DAY) + 1;

  const xs: number[] = new Array(totalDays);
  const p50: Array<number | null> = new Array(totalDays);
  const p95: Array<number | null> = new Array(totalDays);
  const counts: number[] = new Array(totalDays);

  for (let i = 0; i < totalDays; i++) {
    const dayTs = startTs + i * MS_PER_DAY;
    xs[i] = Math.round(dayTs / 1000);
    const bucket = buckets.get(dayTs);

    if (bucket && bucket.length) {
      const sorted = [...bucket].sort((a, b) => a - b);
      p50[i] = bonPercentile(sorted, 0.5);
      p95[i] = bonPercentile(sorted, 0.95);
      counts[i] = bucket.length;
    } else {
      p50[i] = null;
      p95[i] = null;
      counts[i] = 0;
    }
  }

  const palette = bonAnalyticsUplotPalette();
  const { host, tooltip, mount } = bonAnalyticsUplotHost();

  const data: uPlot.AlignedData = [xs, p50, p95];

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
        width: 1.75,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: palette.rust,
        width: 1.5,
        points: { show: false },
        spanGaps: false,
      },
    ],
    axes: bonAnalyticsAxes(palette, {
      xIncrs: [86400],
      xValues: (_u, splits) => splits.map(formatDayTick),
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

          const dayCount = counts[idx];
          if (!dayCount) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = new Date(xs[idx] * 1000).toLocaleDateString();
          tooltip.appendChild(head);

          const sub = document.createElement("div");
          sub.className = "bon-analytics-uplot-tooltip__sub";
          sub.textContent = `${dayCount} ${noun}${dayCount === 1 ? "" : "s"}`;
          tooltip.appendChild(sub);

          const r50 = document.createElement("div");
          r50.className = "bon-analytics-uplot-tooltip__row";
          r50.innerHTML = `<span>p50</span><span>${bonFmtDuration(p50[idx] as number)}</span>`;
          tooltip.appendChild(r50);

          const r95 = document.createElement("div");
          r95.className = "bon-analytics-uplot-tooltip__row";
          r95.innerHTML = `<span>p95</span><span>${bonFmtDuration(p95[idx] as number)}</span>`;
          tooltip.appendChild(r95);

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
