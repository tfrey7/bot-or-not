// Cumulative-spend line chart. Plots running total of run cost over time,
// with a marker on the single most-expensive run and a hover hit-rect per
// segment for tooltips.

import { bonFmtUsd } from "../../utils/format_number.ts";
import type { AnalyticsEntry, AnalyticsSummary } from "./logic.ts";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
  bonAnalyticsTimeAxisFormatter,
} from "./svg.ts";

export function bonAnalyticsCostChart(
  runs: AnalyticsEntry[],
  _summary: AnalyticsSummary
): SVGSVGElement {
  const W = 600;
  const H = 200;
  const PAD = { t: 12, r: 12, b: 28, l: 52 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const root = bonAnalyticsSvgRoot(W, H);

  const sorted = runs
    .filter((r): r is AnalyticsEntry & { runAt: number } => r.runAt != null)
    .sort((a, b) => a.runAt - b.runAt);
  if (!sorted.length) {
    root.appendChild(
      bonAnalyticsEmptyChart(W, H, "No timestamped runs to plot.")
    );
    return root;
  }

  const first = sorted[0].runAt;
  const last = sorted[sorted.length - 1].runAt;
  const span = Math.max(last - first, 1);

  let cum = 0;
  const points = sorted.map((r) => {
    cum += r.totalCost;
    return {
      x: PAD.l + ((r.runAt - first) / span) * iw,
      cum,
      cost: r.totalCost,
      runAt: r.runAt,
      username: r.username,
    };
  });
  const maxCum = cum || 1;

  // Y gridlines + ticks
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
        PAD.l - 8,
        y + 3,
        bonFmtUsd(maxCum * frac),
        null,
        "end"
      )
    );
  }

  // Area + line
  const lineCoords = points
    .map(
      (p) =>
        `${p.x.toFixed(2)},${(PAD.t + ih - (p.cum / maxCum) * ih).toFixed(2)}`
    )
    .join(" L ");
  const area = `M ${PAD.l},${PAD.t + ih} L ${lineCoords} L ${(PAD.l + iw).toFixed(2)},${PAD.t + ih} Z`;
  root.appendChild(
    bonAnalyticsSvgEl("path", { d: area, class: "bon-chart-area" })
  );
  root.appendChild(
    bonAnalyticsSvgEl("path", {
      d: `M ${lineCoords}`,
      class: "bon-chart-line",
    })
  );

  // Highlight the most expensive single run
  let maxIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (sorted[i].totalCost > sorted[maxIdx].totalCost) {
      maxIdx = i;
    }
  }
  const mp = points[maxIdx];
  const my = PAD.t + ih - (mp.cum / maxCum) * ih;
  const marker = bonAnalyticsSvgEl("circle", {
    cx: mp.x,
    cy: my,
    r: 3.5,
    class: "bon-chart-marker",
  });
  const markerTitle = bonAnalyticsSvgEl("title");
  markerTitle.textContent = `Most expensive: u/${mp.username} — ${bonFmtUsd(mp.cost)} (${new Date(mp.runAt).toLocaleString()})`;
  marker.appendChild(markerTitle);
  root.appendChild(marker);

  // X axis time labels — switch to time-of-day when all runs fall within a
  // single day, otherwise three identical date labels would render.
  const xFormatter = bonAnalyticsTimeAxisFormatter(last - first);
  if (last - first < 60_000 || points.length === 1) {
    root.appendChild(
      bonAnalyticsSvgText(
        PAD.l + iw / 2,
        PAD.t + ih + 18,
        xFormatter(first),
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
      const t = first + frac * span;
      const x = PAD.l + frac * iw;
      root.appendChild(
        bonAnalyticsSvgText(x, PAD.t + ih + 18, xFormatter(t), null, anchor)
      );
    });
  }

  // Final value label
  const lastP = points[points.length - 1];
  const lastY = PAD.t + ih - (lastP.cum / maxCum) * ih;
  const cap = bonAnalyticsSvgEl("circle", {
    cx: lastP.x,
    cy: lastY,
    r: 3,
    class: "bon-chart-endpoint",
  });
  root.appendChild(cap);

  // Add hover hit-rects spanning each segment
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = i > 0 ? points[i - 1] : null;
    const next = i < points.length - 1 ? points[i + 1] : null;
    const x = prev ? (prev.x + p.x) / 2 : PAD.l;
    const x2 = next ? (next.x + p.x) / 2 : PAD.l + iw;
    const hit = bonAnalyticsSvgEl("rect", {
      x,
      y: PAD.t,
      width: Math.max(1, x2 - x),
      height: ih,
      fill: "transparent",
    });
    const t = bonAnalyticsSvgEl("title");
    t.textContent = `u/${p.username} · ${new Date(p.runAt).toLocaleString()}\nthis run: ${bonFmtUsd(p.cost)} · cumulative: ${bonFmtUsd(p.cum)}`;
    hit.appendChild(t);
    root.appendChild(hit);
  }

  return root;
}
