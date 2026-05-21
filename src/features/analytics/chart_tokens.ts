// Token mix — a single stacked bar showing how the token spend breaks down
// between fresh input, cache read, cache write, and output. uplot is overkill
// for a one-row segmented bar, so this is rendered as a styled flex layout
// instead; the caption nudges the reader to notice that cache reads are
// ~10× cheaper than fresh input.

import { bonFmtPercent, bonFmtThousands } from "../../utils/format_number.ts";
import type { AnalyticsSummary } from "./logic.ts";
import {
  bonAnalyticsEmptyPanel,
  bonAnalyticsUplotPalette,
} from "./uplot_helpers.ts";

export function bonAnalyticsTokenMix(summary: AnalyticsSummary): HTMLElement {
  const palette = bonAnalyticsUplotPalette();
  const segments = [
    { label: "Fresh input", value: summary.totalInput, color: palette.accent },
    {
      label: "Cache read",
      value: summary.totalCacheRead,
      color: palette.forest,
    },
    {
      label: "Cache write",
      value: summary.totalCacheWrite,
      color: palette.amber,
    },
    { label: "Output", value: summary.totalOutput, color: "#8b5cf6" },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return bonAnalyticsEmptyPanel("No token usage recorded.");
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-token-mix";

  const caption = document.createElement("p");
  caption.className = "bon-analytics-token-caption";
  caption.textContent =
    "Cache reads cost 10× less than fresh input — more green = better economy";
  wrap.appendChild(caption);

  const bar = document.createElement("div");
  bar.className = "bon-analytics-token-bar";

  for (const segment of segments) {
    if (segment.value <= 0) {
      continue;
    }

    const share = segment.value / total;
    const slot = document.createElement("div");
    slot.className = "bon-analytics-token-slot";
    slot.style.flexGrow = String(segment.value);
    slot.style.background = segment.color;
    slot.title = `${segment.label}: ${bonFmtThousands(segment.value)} tokens (${bonFmtPercent(share, 1)})`;

    if (share >= 0.1) {
      const label = document.createElement("span");
      label.className = "bon-analytics-token-slot-label";
      label.textContent = bonFmtPercent(share, 0);
      slot.appendChild(label);
    }

    bar.appendChild(slot);
  }

  wrap.appendChild(bar);

  const legend = document.createElement("ul");
  legend.className = "bon-analytics-token-legend";

  for (const segment of segments) {
    const item = document.createElement("li");
    item.className = "bon-analytics-token-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "bon-analytics-token-legend-swatch";
    swatch.style.background = segment.color;
    item.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "bon-analytics-token-legend-label";
    label.textContent = segment.label;
    item.appendChild(label);

    const value = document.createElement("span");
    value.className = "bon-analytics-token-legend-value";
    value.textContent = `${bonFmtThousands(segment.value)} · ${bonFmtPercent(segment.value / total, 0)}`;
    item.appendChild(value);

    legend.appendChild(item);
  }

  wrap.appendChild(legend);
  return wrap;
}
