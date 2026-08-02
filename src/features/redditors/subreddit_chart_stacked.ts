import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import {
  CAL_GRID_WIDTH_PX,
  CAL_GUTTER_PX,
  redditorsCalendarRange,
} from "./calendar_heatmap.ts";
import {
  redditorsBuildSubredditChartSeries,
  redditorsBuildSubredditTimelines,
  redditorsDetectRampWindows,
  type RampWindow,
  type SubredditChartSeries,
} from "./subreddit_chart_data.ts";
import type { ActivityData } from "../../types.ts";

const TOP_N = 7;
const CHART_HEIGHT = 240;
const TEAR_TEETH = 8;
const TEAR_DEPTH_PX = 4;
const RAMP_SHADE_ALPHA = 0.09;
const TRUNCATED_SHADE_ALPHA = 0.07;

// 12px bar on the calendar's 16px column pitch, mirroring the cell width.
const BAR_WIDTH_RATIO = 0.75;
const OTHER_BAR_ALPHA = 0.6;
const BAR_ALPHA = 0.95;
const DIMMED_BAR_ALPHA = 0.18;

const SERIES_COLOR_VARS = [
  "--bon-stamp-red",
  "--bon-stamp-blue",
  "--bon-stamp-forest",
  "--bon-stamp-amber",
  "--bon-stamp-rust",
  "--bon-stamp-moss",
  "--bon-stamp-slate",
];
const OTHER_COLOR_VAR = "--bon-stamp-charcoal";

interface StackLayer {
  entry: SubredditChartSeries;
  color: string;
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function formatTearTooltip(
  accountCreatedAt: number,
  visibleStart: number
): string {
  const created = new Date(accountCreatedAt).toLocaleDateString();
  const visible = new Date(visibleStart).toLocaleDateString();
  return `Account created ${created} — earlier history not available from the Reddit API. Visible activity starts ${visible}.`;
}

function layerLabel(entry: SubredditChartSeries): string {
  return entry.label === "other" ? "other" : `r/${entry.label}`;
}

// Busiest sub first, "other" always last — the reading order for the legend
// and the tooltip (the stack itself draws bottom-up in this same order, so
// legend rows top-to-bottom don't match bar segments top-to-bottom; matching
// totals-descending wins for scanability).
function sortForDisplay(layers: StackLayer[]): StackLayer[] {
  return [...layers].sort((a, b) => {
    if (a.entry.isOther && !b.entry.isOther) {
      return 1;
    }

    if (!a.entry.isOther && b.entry.isOther) {
      return -1;
    }

    return b.entry.total - a.entry.total;
  });
}

export function redditorsSubredditChartStacked(
  activityData: ActivityData,
  accountCreatedAt: number | null
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-sub-chart bon-sub-chart--stacked";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Subreddit contributions";
  wrap.appendChild(title);

  const timelines = redditorsBuildSubredditTimelines(activityData);

  if (!timelines) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent =
      "Per-subreddit timing data was added after this snapshot was captured — refresh activity to populate it.";
    wrap.appendChild(empty);
    return wrap;
  }

  if (timelines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent = "No public posts or comments to plot.";
    wrap.appendChild(empty);
    return wrap;
  }

  // Same 53-week window and pixel geometry as the calendar heatmap above,
  // one bucket per week column, so dates line up between the two charts.
  const calendarRange = redditorsCalendarRange();
  const rangeStart = calendarRange.start;
  const rangeEnd = calendarRange.end;
  const bucketCount = calendarRange.weeks;

  const earliestEvent = Math.min(
    ...timelines.map((timeline) => timeline.firstSeen)
  );
  const truncatedStart =
    accountCreatedAt && accountCreatedAt < Math.max(earliestEvent, rangeStart)
      ? accountCreatedAt
      : null;

  const rampWindows = redditorsDetectRampWindows(activityData);
  const commentHorizon =
    activityData.commentsLimited &&
    activityData.earliestCommentAt != null &&
    activityData.earliestCommentAt > rangeStart
      ? activityData.earliestCommentAt
      : null;

  const series = redditorsBuildSubredditChartSeries(
    timelines,
    rangeStart,
    rangeEnd,
    bucketCount,
    TOP_N
  );

  // Stack bottom-up: top-ranked subs first so they sit on the baseline where
  // their shape is easiest to read, "other" as the cap on top.
  const stack: StackLayer[] = [];

  series.forEach((entry, index) => {
    if (!entry.isOther) {
      const varName = SERIES_COLOR_VARS[index % SERIES_COLOR_VARS.length];
      stack.push({ entry, color: readCssVar(varName) });
    }
  });

  for (const entry of series) {
    if (entry.isOther) {
      stack.push({ entry, color: readCssVar(OTHER_COLOR_VAR) });
    }
  }

  const bucketWidth = (rangeEnd - rangeStart) / bucketCount;
  const xs: number[] = new Array(bucketCount);

  for (let i = 0; i < bucketCount; i++) {
    xs[i] = Math.round((rangeStart + (i + 0.5) * bucketWidth) / 1000);
  }

  const hidden = new Set<string>();
  let focusedLabel: string | null = null;

  // uPlot only sees the running totals — they drive the y-scale and the
  // cursor index. The bars themselves are painted from the raw per-layer
  // counts in the draw hook below.
  const buildStackedData = (): uPlot.AlignedData => {
    const cumulative = new Array<number>(bucketCount).fill(0);
    const rows: number[][] = [];

    for (const layer of stack) {
      if (!hidden.has(layer.entry.label)) {
        for (let i = 0; i < bucketCount; i++) {
          cumulative[i] += layer.entry.bucketCounts[i];
        }
      }

      rows.push(cumulative.slice());
    }

    return [xs, ...rows] as uPlot.AlignedData;
  };

  const mutedColor = readCssVar("--bon-muted");
  const borderColor = readCssVar("--bon-border");
  const rampColor = readCssVar("--bon-stamp-red");
  const truncatedColor = readCssVar(OTHER_COLOR_VAR);

  const uplotSeries: uPlot.Series[] = [
    {},
    ...stack.map((layer): uPlot.Series => ({
      label: layerLabel(layer.entry),
      stroke: layer.color,
      paths: () => null,
      points: { show: false },
    })),
  ];

  const body = document.createElement("div");
  body.className = "bon-sub-chart-body";
  wrap.appendChild(body);

  const host = document.createElement("div");
  host.className = "bon-sub-chart-uplot";
  body.appendChild(host);

  const tooltip = document.createElement("div");
  tooltip.className = "bon-sub-chart-tooltip";
  tooltip.hidden = true;
  host.appendChild(tooltip);

  const opts: uPlot.Options = {
    // Fixed geometry: y-axis gutter matches the calendar's day-label
    // gutter and the plot area matches its grid width, so week columns
    // land at the same x positions in both charts.
    width: CAL_GUTTER_PX + CAL_GRID_WIDTH_PX,
    height: CHART_HEIGHT,
    padding: [8, 0, 0, 0],
    legend: { show: false },
    cursor: {
      y: false,
      points: { show: false },
    },
    series: uplotSeries,
    scales: {
      x: {
        time: true,
        range: () => [rangeStart / 1000, rangeEnd / 1000],
      },
      y: { range: (_u, _min, max) => [0, Math.max(1, max)] },
    },
    axes: [
      {
        stroke: mutedColor,
        grid: { show: false },
        ticks: { show: true, stroke: borderColor, width: 1, size: 4 },
        border: { show: true, stroke: borderColor, width: 1 },
        font: "10px ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      {
        stroke: mutedColor,
        grid: {
          show: true,
          stroke: borderColor,
          width: 1,
          dash: [2, 3],
        },
        ticks: { show: true, stroke: borderColor, width: 1, size: 4 },
        border: { show: truncatedStart == null, stroke: borderColor, width: 1 },
        size: CAL_GUTTER_PX,
        font: "10px ui-monospace, SFMono-Regular, Menlo, monospace",
      },
    ],
    hooks: {
      drawClear: [
        (u) => {
          const ctx = u.ctx;

          const shadeRange = (
            fromMs: number,
            toMs: number,
            color: string,
            alpha: number
          ) => {
            const left = Math.max(
              u.valToPos(fromMs / 1000, "x", true),
              u.bbox.left
            );
            const right = Math.min(
              u.valToPos(toMs / 1000, "x", true),
              u.bbox.left + u.bbox.width
            );

            if (right <= left) {
              return;
            }

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.fillRect(left, u.bbox.top, right - left, u.bbox.height);
            ctx.restore();
          };

          if (commentHorizon != null) {
            shadeRange(
              rangeStart,
              commentHorizon,
              truncatedColor,
              TRUNCATED_SHADE_ALPHA
            );
          }

          for (const window of rampWindows) {
            shadeRange(window.start, window.end, rampColor, RAMP_SHADE_ALPHA);
          }
        },
      ],
      draw: [
        (u) => {
          const ctx = u.ctx;
          const colWidth =
            bucketCount > 1
              ? Math.abs(
                  u.valToPos(xs[1], "x", true) - u.valToPos(xs[0], "x", true)
                )
              : u.bbox.width;
          const barWidth = Math.max(1, colWidth * BAR_WIDTH_RATIO);

          ctx.save();
          ctx.beginPath();
          ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
          ctx.clip();

          for (let i = 0; i < bucketCount; i++) {
            const xCenter = u.valToPos(xs[i], "x", true);
            let stackBase = 0;

            for (const layer of stack) {
              if (hidden.has(layer.entry.label)) {
                continue;
              }

              const value = layer.entry.bucketCounts[i];

              if (value <= 0) {
                continue;
              }

              const yBottom = u.valToPos(stackBase, "y", true);
              const yTop = u.valToPos(stackBase + value, "y", true);
              const dimmed =
                focusedLabel !== null && focusedLabel !== layer.entry.label;

              ctx.globalAlpha = dimmed
                ? DIMMED_BAR_ALPHA
                : layer.entry.isOther
                  ? OTHER_BAR_ALPHA
                  : BAR_ALPHA;
              ctx.fillStyle = layer.color;
              ctx.fillRect(
                xCenter - barWidth / 2,
                yTop,
                barWidth,
                Math.max(1, yBottom - yTop)
              );

              stackBase += value;
            }
          }

          ctx.restore();
        },
      ],
      setCursor: [
        (u) => {
          const cursor = u.cursor;
          const left = cursor.left;
          const top = cursor.top;
          const idx = cursor.idx;

          if (idx == null || left == null || top == null || left < 0) {
            tooltip.hidden = true;
            return;
          }

          const xVal = (u.data[0] as number[])[idx];
          if (xVal == null) {
            tooltip.hidden = true;
            return;
          }

          tooltip.innerHTML = "";

          const dateRow = document.createElement("div");
          dateRow.className = "bon-sub-chart-tooltip__date";
          dateRow.textContent = new Date(xVal * 1000).toLocaleDateString();
          tooltip.appendChild(dateRow);

          for (const { entry, color } of sortForDisplay(stack)) {
            if (hidden.has(entry.label)) {
              continue;
            }

            const value = entry.bucketCounts[idx];
            const row = document.createElement("div");
            row.className = "bon-sub-chart-tooltip__row";

            const swatch = document.createElement("span");
            swatch.className = "bon-sub-chart-tooltip__swatch";
            swatch.style.setProperty("--bon-series-color", color);
            row.appendChild(swatch);

            const label = document.createElement("span");
            label.className = "bon-sub-chart-tooltip__label";
            label.textContent = layerLabel(entry);
            row.appendChild(label);

            const count = document.createElement("span");
            count.className = "bon-sub-chart-tooltip__count";
            count.textContent = String(value);
            row.appendChild(count);

            tooltip.appendChild(row);
          }

          tooltip.hidden = false;

          const overLeft = u.over.offsetLeft;
          const overTop = u.over.offsetTop;
          const tooltipWidth = tooltip.offsetWidth;
          const hostWidth = host.clientWidth;
          let posX = overLeft + left + 14;

          if (posX + tooltipWidth > hostWidth - 4) {
            posX = overLeft + left - tooltipWidth - 14;
          }

          tooltip.style.left = `${Math.max(4, posX)}px`;
          tooltip.style.top = `${overTop + top + 12}px`;
        },
      ],
      drawAxes: [
        (u) => {
          if (truncatedStart == null) {
            return;
          }

          const ctx = u.ctx;
          const pxr = uPlot.pxRatio;
          const left = u.bbox.left;
          const top = u.bbox.top;
          const height = u.bbox.height;
          const segH = height / TEAR_TEETH;

          ctx.save();
          ctx.strokeStyle = mutedColor;
          ctx.lineWidth = 1 * pxr;
          ctx.lineJoin = "miter";
          ctx.lineCap = "butt";
          ctx.beginPath();

          for (let i = 0; i <= TEAR_TEETH; i++) {
            const y = top + i * segH;
            const x = left + (i % 2 === 0 ? 0 : -TEAR_DEPTH_PX * pxr);
            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }

          ctx.stroke();
          ctx.restore();
        },
      ],
    },
  };

  const plot = new uPlot(opts, buildStackedData(), host);

  if (truncatedStart != null) {
    host.title = formatTearTooltip(truncatedStart, earliestEvent);
  }

  body.appendChild(
    buildLegend(stack, hidden, {
      onToggle: () => {
        plot.setData(buildStackedData());
      },
      onFocus: (label) => {
        focusedLabel = label;
        plot.redraw();
      },
    })
  );

  const notes = buildAnnotationNotes(
    rampWindows,
    commentHorizon,
    rampColor,
    truncatedColor
  );

  if (notes) {
    wrap.appendChild(notes);
  }

  return wrap;
}

function buildAnnotationNotes(
  rampWindows: RampWindow[],
  commentHorizon: number | null,
  rampColor: string,
  truncatedColor: string
): HTMLUListElement | null {
  if (rampWindows.length === 0 && commentHorizon == null) {
    return null;
  }

  const notes = document.createElement("ul");
  notes.className = "bon-sub-chart-notes";

  const addNote = (color: string, text: string) => {
    const item = document.createElement("li");
    item.className = "bon-sub-chart-notes-item";

    const swatch = document.createElement("span");
    swatch.className = "bon-sub-chart-shade-swatch";
    swatch.style.setProperty("--bon-series-color", color);
    item.appendChild(swatch);

    item.appendChild(document.createTextNode(text));
    notes.appendChild(item);
  };

  for (const window of rampWindows) {
    const start = new Date(window.start).toLocaleDateString();
    const end = new Date(window.end).toLocaleDateString();
    addNote(
      rampColor,
      `${start} – ${end}: posting volume ≥5× the account's baseline — possible conversion to bot duty`
    );
  }

  if (commentHorizon != null) {
    const horizon = new Date(commentHorizon).toLocaleDateString();
    addNote(
      truncatedColor,
      `before ${horizon}: comments not visible (Reddit sample cap) — only posts are plotted there`
    );
  }

  return notes;
}

function buildLegend(
  stack: StackLayer[],
  hidden: Set<string>,
  handlers: {
    onToggle: () => void;
    onFocus: (label: string | null) => void;
  }
): HTMLUListElement {
  const legend = document.createElement("ul");
  legend.className = "bon-sub-chart-legend";

  for (const { entry, color } of sortForDisplay(stack)) {
    const item = document.createElement("li");
    item.className = "bon-sub-chart-legend-item";
    item.title = `${layerLabel(entry)} — click to toggle, hover to highlight`;

    const swatch = document.createElement("span");
    swatch.className = "bon-sub-chart-swatch";
    swatch.style.setProperty("--bon-series-color", color);
    item.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "bon-sub-chart-legend-label";
    label.textContent = layerLabel(entry);
    item.appendChild(label);

    const count = document.createElement("span");
    count.className = "bon-sub-chart-legend-count";
    count.textContent = String(entry.total);
    item.appendChild(count);

    item.addEventListener("click", () => {
      if (hidden.has(entry.label)) {
        hidden.delete(entry.label);
      } else {
        hidden.add(entry.label);
      }

      item.classList.toggle(
        "bon-sub-chart-legend-item--off",
        hidden.has(entry.label)
      );
      handlers.onToggle();
    });

    item.addEventListener("mouseenter", () => {
      if (!hidden.has(entry.label)) {
        handlers.onFocus(entry.label);
      }
    });

    item.addEventListener("mouseleave", () => {
      handlers.onFocus(null);
    });

    legend.appendChild(item);
  }

  return legend;
}
