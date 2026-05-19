// Wall-clock Reddit fetch duration per investigation, plotted in time
// order. Successful runs render as dots; runs that hit a Reddit error are
// drawn in the failure colour so a slow-then-erroring trend stands out.

import { bonFmtDuration } from "../../utils/format_time.ts";
import type { AnalyticsEntry } from "./logic.ts";
import { bonAnalyticsRedditFetchTimeline } from "./logic.ts";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
  bonAnalyticsTimeAxisFormatter,
} from "./svg.ts";

export function bonAnalyticsRedditDurationChart(
  runs: AnalyticsEntry[]
): SVGSVGElement {
  const W = 600;
  const H = 200;
  const PAD = { t: 14, r: 14, b: 28, l: 48 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const root = bonAnalyticsSvgRoot(W, H);

  const points = bonAnalyticsRedditFetchTimeline(runs);

  if (!points.length) {
    root.appendChild(
      bonAnalyticsEmptyChart(W, H, "No Reddit fetch timing data yet.")
    );

    return root;
  }

  const first = points[0].runAt;
  const last = points[points.length - 1].runAt;
  const spanMs = Math.max(1, last - first);
  const maxDuration = Math.max(
    1,
    ...points.map((point) => point.totalDurationMs)
  );

  // Y gridlines + tick labels (4 across the range).
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const y = PAD.t + ih - frac * ih;
    root.appendChild(
      bonAnalyticsSvgEl("line", {
        x1: PAD.l,
        y1: y,
        x2: PAD.l + iw,
        y2: y,
        class: "bon-chart-grid",
      })
    );
    root.appendChild(
      bonAnalyticsSvgText(
        PAD.l - 6,
        y + 3,
        bonFmtDuration(maxDuration * frac),
        null,
        "end"
      )
    );
  }

  // Line connecting the points so trend over time is visible — drawn
  // first so error dots sit on top.
  if (points.length > 1) {
    const path = points
      .map((point, i) => {
        const x = PAD.l + ((point.runAt - first) / spanMs) * iw;
        const y = PAD.t + ih - (point.totalDurationMs / maxDuration) * ih;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    root.appendChild(
      bonAnalyticsSvgEl("path", {
        d: path,
        class: "bon-chart-line",
      })
    );
  }

  for (const point of points) {
    const x =
      points.length === 1
        ? PAD.l + iw / 2
        : PAD.l + ((point.runAt - first) / spanMs) * iw;
    const y = PAD.t + ih - (point.totalDurationMs / maxDuration) * ih;
    const dot = bonAnalyticsSvgEl("circle", {
      cx: x.toFixed(2),
      cy: y.toFixed(2),
      r: point.hadError ? 4 : 3,
      class: point.hadError ? "bon-chart-marker" : "bon-chart-endpoint",
    });
    const tooltip = bonAnalyticsSvgEl("title");
    tooltip.textContent =
      `${new Date(point.runAt).toLocaleString()} · ${bonFmtDuration(point.totalDurationMs)}` +
      (point.hadError ? " · fetch error" : "");
    dot.appendChild(tooltip);
    root.appendChild(dot);
  }

  // X-axis labels — start, middle, end. Use the shared time-axis
  // formatter so short windows show time-of-day and longer windows show
  // dates.
  const formatTimeAxis = bonAnalyticsTimeAxisFormatter(spanMs);
  if (points.length === 1) {
    root.appendChild(
      bonAnalyticsSvgText(
        PAD.l + iw / 2,
        PAD.t + ih + 18,
        formatTimeAxis(first),
        null,
        "middle"
      )
    );
  } else {
    [
      { frac: 0, anchor: "start" },
      { frac: 0.5, anchor: "middle" },
      { frac: 1, anchor: "end" },
    ].forEach(({ frac, anchor }) => {
      const timestamp = first + frac * spanMs;
      root.appendChild(
        bonAnalyticsSvgText(
          PAD.l + frac * iw,
          PAD.t + ih + 18,
          formatTimeAxis(timestamp),
          null,
          anchor
        )
      );
    });
  }

  return root;
}
