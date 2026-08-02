// Reddit requests by source — stacked bars, one per local day over the
// telemetry retention window, one color per feature that issued the
// traffic. This is the "what is scanning and when" view: sweeps show up as
// background-colored spikes even when no investigation ran.

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

const WINDOW_DAYS = 7;

const SOURCE_ORDER: RedditSource[] = [
  "investigation",
  "subreddit",
  "attribution",
  "status-recheck",
  "post-recheck",
  "blocklist",
];

const SOURCE_LABELS: Record<RedditSource, string> = {
  investigation: "investigation",
  subreddit: "subreddit sweep",
  attribution: "attribution",
  "status-recheck": "status re-check",
  "post-recheck": "post re-check",
  blocklist: "blocklist cleanup",
};

function sourceColors(
  palette: ReturnType<typeof analyticsUplotPalette>
): Record<RedditSource, string> {
  return {
    investigation: palette.amber,
    subreddit: palette.forest,
    attribution: palette.blue,
    "status-recheck": palette.rust,
    "post-recheck": palette.slate,
    blocklist: palette.red,
  };
}

export function analyticsRedditSourcesChart(
  telemetry: RedditTelemetryState
): HTMLElement {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const dayStarts: number[] = new Array(WINDOW_DAYS);

  for (let i = 0; i < WINDOW_DAYS; i++) {
    const day = new Date(todayStart);
    day.setDate(day.getDate() - (WINDOW_DAYS - 1 - i));
    dayStarts[i] = day.getTime();
  }

  const slotForTimestamp = (timestamp: number): number => {
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      if (timestamp >= dayStarts[i]) {
        return i;
      }
    }

    return -1;
  };

  // Per-source counts per day slot (ok + error — the chart shows load, the
  // tooltip breaks out errors).
  const perSource = new Map<RedditSource, number[]>();
  const errors: number[] = new Array<number>(WINDOW_DAYS).fill(0);

  for (const source of SOURCE_ORDER) {
    perSource.set(source, new Array<number>(WINDOW_DAYS).fill(0));
  }

  let total = 0;

  for (const bucket of telemetry.hourly) {
    const slot = slotForTimestamp(bucket.hour * MS_PER_HOUR);
    if (slot < 0) {
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
    return analyticsEmptyPanel("No Reddit traffic in the last 7 days.");
  }

  const xs: number[] = new Array(WINDOW_DAYS);

  for (let i = 0; i < WINDOW_DAYS; i++) {
    xs[i] = (dayStarts[i] + 43_200_000) / 1000;
  }

  // Stacked bars via cumulative sums: draw the tallest cumulative first and
  // each shorter one on top, so the visible strip of each series is exactly
  // that source's share.
  const cumulative: Array<Array<number | null>> = [];
  const running = new Array<number>(WINDOW_DAYS).fill(0);

  for (const source of SOURCE_ORDER) {
    const counts = perSource.get(source)!;

    for (let i = 0; i < WINDOW_DAYS; i++) {
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
      // Pad ½ day on each side so the first/last bar isn't clipped.
      x: {
        time: true,
        range: (_u, min, max) => [min - 43_200, max + 43_200],
      },
      y: {
        range: (_u, _min, max) => [0, Math.max(1, Math.ceil(max))],
      },
    },
    series,
    axes: analyticsAxes(palette, {
      // One tick per bar, pinned to the bar centers — uPlot's own day
      // splits land on UTC midnights, which drift a label off per timezone.
      xSplits: () => xs,
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

          if (idx == null || left < 0 || top < 0 || !totals[idx]) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const head = document.createElement("div");
          head.className = "bon-analytics-uplot-tooltip__head";
          head.textContent = new Date(xs[idx] * 1000).toLocaleDateString();
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
