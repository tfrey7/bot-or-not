// Daily-activity bar chart — one bar per calendar day in the last 30 days,
// height proportional to runs that day. Tooltip shows the day's spend.

import { bonFmtUsd } from "../../utils/format_number.ts";
import type { AnalyticsEntry } from "./logic.ts";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
} from "./svg.ts";

const MS_PER_DAY = 86_400_000;

export function bonAnalyticsActivityChart(
  runs: AnalyticsEntry[]
): SVGSVGElement {
  const W = 600;
  const H = 200;
  const PAD = { t: 12, r: 8, b: 28, l: 36 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const root = bonAnalyticsSvgRoot(W, H);

  const runsWithTime = runs.filter(
    (run): run is AnalyticsEntry & { runAt: number } => run.runAt != null
  );

  if (!runsWithTime.length) {
    root.appendChild(
      bonAnalyticsEmptyChart(W, H, "No timestamped runs to plot.")
    );

    return root;
  }

  const buckets = new Map<number, { count: number; cost: number }>();
  let earliest = Infinity;

  for (const run of runsWithTime) {
    const day = new Date(run.runAt);
    day.setHours(0, 0, 0, 0);
    const timestamp = day.getTime();
    earliest = Math.min(earliest, timestamp);
    const bucket = buckets.get(timestamp) || { count: 0, cost: 0 };
    bucket.count++;
    bucket.cost += run.totalCost;
    buckets.set(timestamp, bucket);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const maxSpan = 30 * MS_PER_DAY;
  const startTs = Math.max(earliest, todayTs - maxSpan);
  const totalDays = Math.round((todayTs - startTs) / MS_PER_DAY) + 1;
  const maxCount = Math.max(
    1,
    ...Array.from(buckets.values(), (bucket) => bucket.count)
  );
  const barW = iw / totalDays;

  // Y gridlines
  const yTicks = Math.min(4, maxCount);

  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const y = PAD.t + ih - frac * ih;
    const tickValue = Math.round(maxCount * frac);
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
      bonAnalyticsSvgText(PAD.l - 6, y + 3, String(tickValue), null, "end")
    );
  }

  for (let i = 0; i < totalDays; i++) {
    const timestamp = startTs + i * MS_PER_DAY;
    const bucket = buckets.get(timestamp);

    if (!bucket) {
      continue;
    }

    const h = (bucket.count / maxCount) * ih;
    const x = PAD.l + i * barW + 1;
    const y = PAD.t + ih - h;
    const rect = bonAnalyticsSvgEl("rect", {
      x: x.toFixed(2),
      y: y.toFixed(2),
      width: Math.max(1, barW - 2).toFixed(2),
      height: h.toFixed(2),
      rx: 1.5,
      class: "bon-chart-bar bon-chart-bar--blue",
    });
    const tooltip = bonAnalyticsSvgEl("title");
    tooltip.textContent = `${new Date(timestamp).toLocaleDateString()} — ${bucket.count} run${bucket.count === 1 ? "" : "s"} · ${bonFmtUsd(bucket.cost)}`;
    rect.appendChild(tooltip);
    root.appendChild(rect);
  }

  if (totalDays === 1) {
    root.appendChild(
      bonAnalyticsSvgText(
        PAD.l + iw / 2,
        PAD.t + ih + 18,
        new Date(startTs).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
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
      const timestamp = startTs + frac * (totalDays - 1) * MS_PER_DAY;
      root.appendChild(
        bonAnalyticsSvgText(
          PAD.l + frac * iw,
          PAD.t + ih + 18,
          new Date(timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          null,
          anchor
        )
      );
    });
  }

  return root;
}
