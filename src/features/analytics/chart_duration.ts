// Duration histogram — runs binned by how long they took, plus a vertical
// line marking the median.

import { bonFmtPercent } from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import { bonPercentile } from "../../utils/stats.ts";
import type { AnalyticsEntry } from "./logic.ts";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
} from "./svg.ts";

export function bonAnalyticsDurationChart(
  runs: AnalyticsEntry[]
): SVGSVGElement {
  const W = 600;
  const H = 200;
  const PAD = { t: 10, r: 10, b: 38, l: 32 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const root = bonAnalyticsSvgRoot(W, H);

  const durations = runs
    .map((r) => r.durationMs)
    .filter((d): d is number => typeof d === "number");

  if (!durations.length) {
    root.appendChild(bonAnalyticsEmptyChart(W, H, "No duration data."));
    return root;
  }

  const buckets = [
    { label: "<15s", max: 15_000 },
    { label: "15–30s", max: 30_000 },
    { label: "30–60s", max: 60_000 },
    { label: "1–1.5m", max: 90_000 },
    { label: "1.5–2m", max: 120_000 },
    { label: "2–3m", max: 180_000 },
    { label: "3m+", max: Infinity },
  ];
  const counts: number[] = new Array(buckets.length).fill(0);

  for (const d of durations) {
    let idx = buckets.findIndex((b) => d < b.max);

    if (idx === -1) {
      idx = buckets.length - 1;
    }

    counts[idx]++;
  }

  const maxCount = Math.max(1, ...counts);
  const barW = iw / buckets.length;

  const yTicks = Math.min(4, maxCount);
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
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
        String(Math.round(maxCount * frac)),
        null,
        "end"
      )
    );
  }

  for (let i = 0; i < buckets.length; i++) {
    const c = counts[i];
    const x = PAD.l + i * barW + 5;
    const w = barW - 10;

    if (c > 0) {
      const h = (c / maxCount) * ih;
      const y = PAD.t + ih - h;
      const rect = bonAnalyticsSvgEl("rect", {
        x: x.toFixed(2),
        y: y.toFixed(2),
        width: w.toFixed(2),
        height: h.toFixed(2),
        rx: 2,
        class: "bon-chart-bar bon-chart-bar--teal",
      });
      const t = bonAnalyticsSvgEl("title");
      t.textContent = `${buckets[i].label}: ${c} run${c === 1 ? "" : "s"} (${bonFmtPercent(c / durations.length)} of total)`;
      rect.appendChild(t);
      root.appendChild(rect);
    }

    root.appendChild(
      bonAnalyticsSvgText(
        PAD.l + i * barW + barW / 2,
        PAD.t + ih + 18,
        buckets[i].label,
        null,
        "middle"
      )
    );
  }

  // Median marker line — value lives in the card subtitle, so the line is
  // unlabeled to avoid overlapping the bar-count number on tall bars. A
  // tooltip keeps the exact median discoverable.
  const medianMs = bonPercentile(
    [...durations].sort((a, b) => a - b),
    0.5
  );
  let medianBucket = buckets.findIndex((b) => medianMs < b.max);

  if (medianBucket === -1) {
    medianBucket = buckets.length - 1;
  }

  const medianX = PAD.l + medianBucket * barW + barW / 2;
  const medianLine = bonAnalyticsSvgEl("line", {
    x1: medianX,
    y1: PAD.t,
    x2: medianX,
    y2: PAD.t + ih,
    class: "bon-chart-median-line",
  });
  const medianTitle = bonAnalyticsSvgEl("title");
  medianTitle.textContent = `Median run: ${bonFmtDuration(medianMs)}`;
  medianLine.appendChild(medianTitle);
  root.appendChild(medianLine);
  return root;
}
