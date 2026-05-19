// Per-endpoint timing chart. One horizontal bar per Reddit endpoint;
// bar length = median duration, marker = p95. The slowest endpoint
// jumps out at a glance and the gap between median and p95 shows tail
// behaviour.

import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonPercentile } from "../../utils/stats.ts";
import type { AnalyticsRedditSummary } from "./logic.ts";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
} from "./svg.ts";

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
): SVGSVGElement {
  const W = 600;
  const ROW_H = 28;
  const PAD = { t: 14, r: 70, b: 24, l: 96 };
  const root = bonAnalyticsSvgRoot(
    W,
    reddit.endpoints.length * ROW_H + PAD.t + PAD.b
  );

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

  const anyData = stats.some((stat) => stat.fetches > 0);

  if (!anyData) {
    const H = reddit.endpoints.length * ROW_H + PAD.t + PAD.b;
    root.appendChild(bonAnalyticsEmptyChart(W, H, "No fetch metrics yet."));
    return root;
  }

  const iw = W - PAD.l - PAD.r;
  const scaleMax = Math.max(1, ...stats.map((stat) => stat.max || stat.p95));

  // X gridlines — 4 ticks across the chart so eyeballing the bar length
  // back to a millisecond value is easy.
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const x = PAD.l + frac * iw;
    root.appendChild(
      bonAnalyticsSvgEl("line", {
        x1: x,
        y1: PAD.t,
        x2: x,
        y2: PAD.t + reddit.endpoints.length * ROW_H,
        class: "bon-chart-grid",
      })
    );
    root.appendChild(
      bonAnalyticsSvgText(
        x,
        PAD.t + reddit.endpoints.length * ROW_H + 14,
        bonFmtDuration(scaleMax * frac),
        null,
        "middle"
      )
    );
  }

  stats.forEach((stat, i) => {
    const yRow = PAD.t + i * ROW_H;
    const yCenter = yRow + ROW_H / 2;

    root.appendChild(
      bonAnalyticsSvgText(PAD.l - 8, yCenter + 3, stat.endpoint, null, "end")
    );

    if (stat.fetches === 0) {
      root.appendChild(
        bonAnalyticsSvgText(
          PAD.l + 6,
          yCenter + 3,
          "no data",
          "bon-chart-caption",
          "start"
        )
      );
      return;
    }

    const barH = ROW_H - 12;
    const barY = yRow + 6;
    const barW = Math.max(2, (stat.median / scaleMax) * iw);

    const rect = bonAnalyticsSvgEl("rect", {
      x: PAD.l,
      y: barY,
      width: barW,
      height: barH,
      rx: 2,
      class: "bon-chart-bar bon-chart-bar--teal",
    });
    const tooltip = bonAnalyticsSvgEl("title");
    tooltip.textContent =
      `${stat.endpoint}: ${stat.fetches} fetch${stat.fetches === 1 ? "" : "es"}` +
      ` · median ${bonFmtDuration(stat.median)} · p95 ${bonFmtDuration(stat.p95)}` +
      ` · max ${bonFmtDuration(stat.max)}` +
      (stat.errors > 0
        ? ` · ${stat.errors} error${stat.errors === 1 ? "" : "s"}`
        : "");
    rect.appendChild(tooltip);
    root.appendChild(rect);

    // p95 marker — tick line at the 95th-percentile x position with the
    // duration printed past the right edge of the bar.
    const p95X = PAD.l + (stat.p95 / scaleMax) * iw;
    root.appendChild(
      bonAnalyticsSvgEl("line", {
        x1: p95X,
        y1: barY - 2,
        x2: p95X,
        y2: barY + barH + 2,
        class: "bon-chart-median-line",
      })
    );

    const rightLabel =
      stat.errors > 0
        ? `${bonFmtDuration(stat.p95)} · ${stat.errors} err`
        : bonFmtDuration(stat.p95);
    root.appendChild(
      bonAnalyticsSvgText(
        PAD.l + iw + 6,
        yCenter + 3,
        rightLabel,
        stat.errors > 0 ? "bon-chart-label" : null,
        "start"
      )
    );
  });

  return root;
}
