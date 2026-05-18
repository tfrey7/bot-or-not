// Token mix — single stacked bar showing how the token spend breaks down
// between fresh input, cache read, cache write, and output. The caption
// nudges the reader to notice that cache reads are 10× cheaper.

import { bonFmtPercent, bonFmtThousands } from "../../utils/format_number.js";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
} from "./svg.js";

export function bonAnalyticsTokenMix(s) {
  const W = 600;
  const H = 200;
  const root = bonAnalyticsSvgRoot(W, H);

  const segments = [
    { label: "Fresh input", value: s.totalInput, color: "#3b82f6" },
    { label: "Cache read", value: s.totalCacheRead, color: "#16a085" },
    { label: "Cache write", value: s.totalCacheWrite, color: "#f59e0b" },
    { label: "Output", value: s.totalOutput, color: "#8b5cf6" },
  ];
  const total = segments.reduce((a, b) => a + b.value, 0);
  if (total === 0) {
    root.appendChild(bonAnalyticsEmptyChart(W, H, "No token usage recorded."));
    return root;
  }

  const BAR_Y = 60;
  const BAR_H = 42;
  const PAD = 24;
  const innerW = W - PAD * 2;

  // Caption above the bar
  root.appendChild(
    bonAnalyticsSvgText(
      W / 2,
      32,
      "Cache reads cost 10× less than fresh input — more green = better economy",
      "bon-chart-caption",
      "middle"
    )
  );

  let x = PAD;
  for (const seg of segments) {
    const w = (seg.value / total) * innerW;
    if (w <= 0) {
      continue;
    }
    const rect = bonAnalyticsSvgEl("rect", {
      x: x.toFixed(2),
      y: BAR_Y,
      width: w.toFixed(2),
      height: BAR_H,
      fill: seg.color,
    });
    const title = bonAnalyticsSvgEl("title");
    title.textContent = `${seg.label}: ${bonFmtThousands(seg.value)} tokens (${bonFmtPercent(seg.value / total, 1)})`;
    rect.appendChild(title);
    root.appendChild(rect);

    if (w > 60) {
      root.appendChild(
        bonAnalyticsSvgText(
          x + w / 2,
          BAR_Y + BAR_H / 2 + 5,
          bonFmtPercent(seg.value / total, 0),
          "bon-chart-inbar",
          "middle"
        )
      );
    }
    x += w;
  }

  // Legend grid (2x2)
  const legendStartY = BAR_Y + BAR_H + 28;
  const legendColW = innerW / 2;
  segments.forEach((seg, i) => {
    const lx = PAD + (i % 2) * legendColW;
    const ly = legendStartY + Math.floor(i / 2) * 22;
    root.appendChild(
      bonAnalyticsSvgEl("rect", {
        x: lx,
        y: ly - 8,
        width: 11,
        height: 11,
        rx: 2,
        fill: seg.color,
      })
    );
    root.appendChild(
      bonAnalyticsSvgText(
        lx + 18,
        ly + 1,
        `${seg.label} — ${bonFmtThousands(seg.value)} (${bonFmtPercent(seg.value / total, 0)})`,
        "bon-chart-legend"
      )
    );
  });

  return root;
}
