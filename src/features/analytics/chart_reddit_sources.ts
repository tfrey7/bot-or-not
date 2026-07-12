// Reddit requests by source — stacked bars, one per hour over the last 48
// hours, one color per feature that issued the traffic. This is the "what
// is scanning and when" view: sweeps show up as background-colored spikes
// even when no investigation ran.

import uPlot from "uplot";

import { MS_PER_HOUR } from "../../reddit/telemetry.ts";
import type {
  RedditSource,
  RedditTelemetryState,
} from "../../reddit/telemetry.ts";
import { formatDayTick } from "./tick_helpers.ts";
import {
  analyticsAxes,
  analyticsEmptyPanel,
  analyticsPlaceTooltip,
  analyticsUplotHost,
  analyticsUplotPalette,
  type UplotChartOptions,
} from "./uplot_helpers.ts";

const WINDOW_HOURS = 48;

const SOURCE_ORDER: RedditSource[] = [
  "investigation",
  "subreddit",
  "attribution",
  "status-recheck",
  "blocklist",
];

const SOURCE_LABELS: Record<RedditSource, string> = {
  investigation: "investigation",
  subreddit: "subreddit sweep",
  attribution: "attribution",
  "status-recheck": "status re-check",
  blocklist: "blocklist cleanup",
};

function sourceColors(
  palette: ReturnType<typeof analyticsUplotPalette>
): Record<RedditSource, string> {
  return {
    investigation: palette.accent,
    subreddit: palette.forest,
    attribution: palette.amber,
    "status-recheck": palette.rust,
    blocklist: palette.red,
  };
}

function formatHourTick(secondsEpoch: number): string {
  const date = new Date(secondsEpoch * 1000);

  if (date.getHours() === 0) {
    return formatDayTick(secondsEpoch);
  }

  return `${date.getHours()}h`;
}

export function analyticsRedditSourcesChart(
  telemetry: RedditTelemetryState
): HTMLElement {
  const nowHour = Math.floor(Date.now() / MS_PER_HOUR);
  const firstHour = nowHour - (WINDOW_HOURS - 1);

  // Per-source counts per hour slot (ok + error — the chart shows load, the
  // tooltip breaks out errors).
  const perSource = new Map<RedditSource, number[]>();
  const errors: number[] = new Array<number>(WINDOW_HOURS).fill(0);

  for (const source of SOURCE_ORDER) {
    perSource.set(source, new Array<number>(WINDOW_HOURS).fill(0));
  }

  let total = 0;

  for (const bucket of telemetry.hourly) {
    const slot = bucket.hour - firstHour;
    if (slot < 0 || slot >= WINDOW_HOURS) {
      continue;
    }

    for (const source of SOURCE_ORDER) {
      const tally = bucket.counts[source];
      if (!tally) {
        continue;
      }

      perSource.get(source)![slot] += tally.ok + tally.error;
      errors[slot] += tally.error;
      total += tally.ok + tally.error;
    }
  }

  if (total === 0) {
    return analyticsEmptyPanel("No Reddit traffic in the last 48 hours.");
  }

  const xs: number[] = new Array(WINDOW_HOURS);

  for (let i = 0; i < WINDOW_HOURS; i++) {
    xs[i] = ((firstHour + i) * MS_PER_HOUR) / 1000;
  }

  // Stacked bars via cumulative sums: draw the tallest cumulative first and
  // each shorter one on top, so the visible strip of each series is exactly
  // that source's share.
  const cumulative: Array<Array<number | null>> = [];
  const running = new Array<number>(WINDOW_HOURS).fill(0);

  for (const source of SOURCE_ORDER) {
    const counts = perSource.get(source)!;

    for (let i = 0; i < WINDOW_HOURS; i++) {
      running[i] += counts[i];
    }

    cumulative.push(running.map((value) => (value > 0 ? value : null)));
  }

  const palette = analyticsUplotPalette();
  const colors = sourceColors(palette);
  const { host, tooltip, mount } = analyticsUplotHost();

  const barWidth = 0.7;
  const series: uPlot.Series[] = [{}];
  const data: uPlot.AlignedData = [xs] as unknown as uPlot.AlignedData;

  for (let i = SOURCE_ORDER.length - 1; i >= 0; i--) {
    const color = colors[SOURCE_ORDER[i]];
    series.push({
      stroke: color,
      fill: color,
      width: 0,
      paths: uPlot.paths.bars!({ size: [barWidth, 32] }),
      points: { show: false },
    });
    (data as unknown as Array<Array<number | null>>).push(cumulative[i]);
  }

  const totals = cumulative[cumulative.length - 1];

  const opts: UplotChartOptions = {
    legend: { show: false },
    cursor: {
      points: { show: false },
      focus: { prox: 24 },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      // Pad ½ hour on each side so the first/last bar isn't clipped.
      x: {
        time: true,
        range: (_u, min, max) => [min - 1_800, max + 1_800],
      },
      y: {
        range: (_u, _min, max) => [0, Math.max(1, Math.ceil(max))],
      },
    },
    series,
    axes: analyticsAxes(palette, {
      xIncrs: [21_600, 43_200, 86_400],
      xValues: (_u, splits) => splits.map(formatHourTick),
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

          if (idx == null || left < 0 || top < 0 || !totals[idx]) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          const when = new Date(xs[idx] * 1000);
          head.textContent = `${when.toLocaleDateString()} ${when.getHours()}:00`;
          tooltip.appendChild(head);

          for (const source of SOURCE_ORDER) {
            const count = perSource.get(source)![idx];
            if (count === 0) {
              continue;
            }

            const row = document.createElement("div");
            row.className = "bon-analytics-uplot-tooltip__row";
            row.innerHTML = `<span>${SOURCE_LABELS[source]}</span><span>${count}</span>`;
            tooltip.appendChild(row);
          }

          if (errors[idx] > 0) {
            const row = document.createElement("div");
            row.className = "bon-analytics-uplot-tooltip__row";
            row.innerHTML = `<span>errors</span><span>${errors[idx]}</span>`;
            tooltip.appendChild(row);
          }

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

  const legend = document.createElement("div");
  legend.className = "bon-analytics-source-legend";

  for (const source of SOURCE_ORDER) {
    if (!perSource.get(source)!.some((count) => count > 0)) {
      continue;
    }

    const item = document.createElement("span");
    item.className = "bon-analytics-source-legend-item";

    const swatch = document.createElement("i");
    swatch.style.background = colors[source];
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(SOURCE_LABELS[source]));
    legend.appendChild(item);
  }

  host.appendChild(legend);
  return host;
}
