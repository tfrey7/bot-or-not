// Daily-activity bar chart — one bar per calendar day in the last 30 days,
// height proportional to runs that day. Tooltip shows the day's spend.

import { bonFmtUsd } from "../../utils/format_number.js";
import {
  bonAnalyticsEmptyChart,
  bonAnalyticsSvgEl,
  bonAnalyticsSvgRoot,
  bonAnalyticsSvgText,
} from "./svg.js";

const MS_PER_DAY = 86_400_000;

export function bonAnalyticsActivityChart(runs) {
  const W = 600;
  const H = 200;
  const PAD = { t: 12, r: 8, b: 28, l: 36 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const root = bonAnalyticsSvgRoot(W, H);

  const runsWithTime = runs.filter((r) => r.runAt);
  if (!runsWithTime.length) {
    root.appendChild(
      bonAnalyticsEmptyChart(W, H, "No timestamped runs to plot.")
    );
    return root;
  }

  const buckets = new Map();
  let earliest = Infinity;
  for (const r of runsWithTime) {
    const d = new Date(r.runAt);
    d.setHours(0, 0, 0, 0);
    const ts = d.getTime();
    earliest = Math.min(earliest, ts);
    const b = buckets.get(ts) || { count: 0, cost: 0 };
    b.count++;
    b.cost += r.totalCost;
    buckets.set(ts, b);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const maxSpan = 30 * MS_PER_DAY;
  const startTs = Math.max(earliest, todayTs - maxSpan);
  const totalDays = Math.round((todayTs - startTs) / MS_PER_DAY) + 1;
  const maxCount = Math.max(1, ...Array.from(buckets.values(), (b) => b.count));
  const barW = iw / totalDays;

  // Y gridlines
  const yTicks = Math.min(4, maxCount);
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const y = PAD.t + ih - frac * ih;
    const val = Math.round(maxCount * frac);
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
      bonAnalyticsSvgText(PAD.l - 6, y + 3, String(val), null, "end")
    );
  }

  for (let i = 0; i < totalDays; i++) {
    const ts = startTs + i * MS_PER_DAY;
    const b = buckets.get(ts);
    if (!b) {
      continue;
    }
    const h = (b.count / maxCount) * ih;
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
    const t = bonAnalyticsSvgEl("title");
    t.textContent = `${new Date(ts).toLocaleDateString()} — ${b.count} run${b.count === 1 ? "" : "s"} · ${bonFmtUsd(b.cost)}`;
    rect.appendChild(t);
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
      const ts = startTs + frac * (totalDays - 1) * MS_PER_DAY;
      root.appendChild(
        bonAnalyticsSvgText(
          PAD.l + frac * iw,
          PAD.t + ih + 18,
          new Date(ts).toLocaleDateString(undefined, {
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
