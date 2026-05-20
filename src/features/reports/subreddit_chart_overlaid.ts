import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import {
  bonReportsBuildSubredditChartSeries,
  bonReportsBuildSubredditTimelines,
} from "./logic.ts";
import type { SubredditChartSeries } from "./logic.ts";
import type { ActivityData } from "../../types.ts";

const BUCKET_COUNT = 96;
const TOP_N = 5;
const CHART_HEIGHT = 240;
const GLOW_BLUR_PX = 7;
const TEAR_TEETH = 8;
const TEAR_DEPTH_PX = 4;

const SERIES_COLOR_VARS = [
  "--bon-stamp-red",
  "--bon-stamp-blue",
  "--bon-stamp-forest",
  "--bon-stamp-amber",
  "--bon-stamp-rust",
];
const OTHER_COLOR_VAR = "--bon-stamp-charcoal";

function bonReadCssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function bonFormatTearTooltip(
  accountCreatedAt: number,
  visibleStart: number
): string {
  const created = new Date(accountCreatedAt).toLocaleDateString();
  const visible = new Date(visibleStart).toLocaleDateString();
  return `Account created ${created} — earlier history not available from the Reddit API. Visible activity starts ${visible}.`;
}

export function bonReportsSubredditChartOverlaid(
  activityData: ActivityData,
  accountCreatedAt: number | null
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-sub-chart bon-sub-chart--overlaid";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Subreddit contributions";
  wrap.appendChild(title);

  const timelines = bonReportsBuildSubredditTimelines(activityData);

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

  const earliestEvent = Math.min(
    ...timelines.map((timeline) => timeline.firstSeen)
  );
  const latestEvent = Math.max(
    ...timelines.map((timeline) => timeline.lastSeen)
  );
  const rangeStart = earliestEvent;
  const rangeEnd = Math.max(latestEvent, Date.now());
  const truncatedStart =
    accountCreatedAt && accountCreatedAt < earliestEvent
      ? accountCreatedAt
      : null;

  const series = bonReportsBuildSubredditChartSeries(
    timelines,
    rangeStart,
    rangeEnd,
    BUCKET_COUNT,
    TOP_N
  );

  // "Other" first so the top subs paint over it; preserve the original
  // index so the swatch colors line up with the legend.
  const ordered: { entry: SubredditChartSeries; color: string }[] = [];

  for (const entry of series) {
    if (entry.isOther) {
      ordered.push({ entry, color: bonReadCssVar(OTHER_COLOR_VAR) });
    }
  }

  series.forEach((entry, index) => {
    if (!entry.isOther) {
      const varName = SERIES_COLOR_VARS[index % SERIES_COLOR_VARS.length];
      ordered.push({ entry, color: bonReadCssVar(varName) });
    }
  });

  const bucketWidth = (rangeEnd - rangeStart) / BUCKET_COUNT;
  const xs: number[] = new Array(BUCKET_COUNT);

  for (let i = 0; i < BUCKET_COUNT; i++) {
    xs[i] = Math.round((rangeStart + (i + 0.5) * bucketWidth) / 1000);
  }

  const data: uPlot.AlignedData = [
    xs,
    ...ordered.map((item) => item.entry.bucketCounts),
  ];

  const mutedColor = bonReadCssVar("--bon-muted");
  const borderColor = bonReadCssVar("--bon-border");

  const uplotSeries: uPlot.Series[] = [
    {},
    ...ordered.map(
      (item): uPlot.Series => ({
        label: item.entry.label === "other" ? "other" : `r/${item.entry.label}`,
        stroke: item.color,
        width: item.entry.isOther ? 1.2 : 1.8,
        alpha: item.entry.isOther ? 0.55 : 1,
        points: { show: false },
      })
    ),
  ];

  const host = document.createElement("div");
  host.className = "bon-sub-chart-uplot";
  wrap.appendChild(host);

  const tooltip = document.createElement("div");
  tooltip.className = "bon-sub-chart-tooltip";
  tooltip.hidden = true;
  host.appendChild(tooltip);

  const opts: uPlot.Options = {
    width: host.clientWidth || 640,
    height: CHART_HEIGHT,
    legend: { show: false },
    cursor: {
      points: { size: 6 },
      focus: { prox: 24 },
    },
    focus: { alpha: 0.25 },
    series: uplotSeries,
    scales: {
      x: { time: true },
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
        size: 36,
        font: "10px ui-monospace, SFMono-Regular, Menlo, monospace",
      },
    ],
    hooks: {
      drawSeries: [
        (u, seriesIdx) => {
          if (seriesIdx === 0) {
            return;
          }

          const s = u.series[seriesIdx] as uPlot.Series & {
            _paths?: { stroke?: Path2D | null } | null;
          };

          if (!s.show || !s._paths || !s._paths.stroke) {
            return;
          }

          const ctx = u.ctx;
          const pxr = uPlot.pxRatio;
          ctx.save();
          ctx.shadowBlur = GLOW_BLUR_PX * pxr;
          ctx.shadowColor = s.stroke as string;
          ctx.strokeStyle = s.stroke as string;
          ctx.lineWidth = (s.width ?? 1) * pxr;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.globalAlpha = (s.alpha as number | undefined) ?? 1;
          ctx.stroke(s._paths.stroke);
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

          const rows = [...ordered].sort((a, b) => {
            if (a.entry.isOther && !b.entry.isOther) {
              return 1;
            }

            if (!a.entry.isOther && b.entry.isOther) {
              return -1;
            }

            return b.entry.total - a.entry.total;
          });

          for (const { entry, color } of rows) {
            const value = entry.bucketCounts[idx];
            const row = document.createElement("div");
            row.className = "bon-sub-chart-tooltip__row";

            const swatch = document.createElement("span");
            swatch.className = "bon-sub-chart-tooltip__swatch";
            swatch.style.setProperty("--bon-series-color", color);
            row.appendChild(swatch);

            const label = document.createElement("span");
            label.className = "bon-sub-chart-tooltip__label";
            label.textContent =
              entry.label === "other" ? "other" : `r/${entry.label}`;
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

  const plot = new uPlot(opts, data, host);

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0 && width !== plot.width) {
        plot.setSize({ width, height: CHART_HEIGHT });
      }
    }
  });
  ro.observe(host);

  if (truncatedStart != null) {
    host.title = bonFormatTearTooltip(truncatedStart, earliestEvent);
  }

  wrap.appendChild(bonBuildLegend(ordered));
  return wrap;
}

function bonBuildLegend(
  ordered: { entry: SubredditChartSeries; color: string }[]
): HTMLUListElement {
  const legend = document.createElement("ul");
  legend.className = "bon-sub-chart-legend";

  // Restore the natural top-1, top-2, … order in the legend (the chart draws
  // "other" first so it sits under the headline subs, but readers expect
  // legends to lead with the busiest sub).
  const display = [...ordered].sort((a, b) => {
    if (a.entry.isOther && !b.entry.isOther) {
      return 1;
    }

    if (!a.entry.isOther && b.entry.isOther) {
      return -1;
    }

    return b.entry.total - a.entry.total;
  });

  for (const { entry, color } of display) {
    const item = document.createElement("li");
    item.className = "bon-sub-chart-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "bon-sub-chart-swatch";
    swatch.style.setProperty("--bon-series-color", color);
    item.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "bon-sub-chart-legend-label";
    label.textContent = entry.label === "other" ? "other" : `r/${entry.label}`;
    item.appendChild(label);

    const count = document.createElement("span");
    count.className = "bon-sub-chart-legend-count";
    count.textContent = String(entry.total);
    item.appendChild(count);

    legend.appendChild(item);
  }

  return legend;
}
