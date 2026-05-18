// SVG helpers shared by the analytics chart widgets. Pure DOM builders;
// no business logic.

const SVG_NS = "http://www.w3.org/2000/svg";
const MS_PER_DAY = 86_400_000;

export function bonAnalyticsSvgRoot(
  w: number,
  h: number,
  classes?: string
): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", `0 0 ${w} ${h}`);
  el.setAttribute("preserveAspectRatio", "none");
  el.setAttribute("class", classes || "bon-chart-svg");
  return el;
}

export function bonAnalyticsSvgEl(
  name: string,
  attrs?: Record<string, string | number>
): SVGElement {
  const e = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      e.setAttribute(k, String(v));
    }
  }
  return e;
}

export function bonAnalyticsSvgText(
  x: number,
  y: number,
  text: string,
  cls?: string | null,
  anchor?: string | null
): SVGElement {
  const t = bonAnalyticsSvgEl("text", {
    x,
    y,
    class: cls || "bon-chart-tick",
  });

  if (anchor) {
    t.setAttribute("text-anchor", anchor);
  }

  t.textContent = text;
  return t;
}

export function bonAnalyticsEmptyChart(
  w: number,
  h: number,
  text: string
): SVGElement {
  return bonAnalyticsSvgText(w / 2, h / 2, text, "bon-chart-empty", "middle");
}

// Picks date vs. time-of-day formatting based on how much wall-clock the
// chart actually spans, so axes stay informative whether the runs are spread
// across weeks or clustered in a single afternoon.
export function bonAnalyticsTimeAxisFormatter(
  spanMs: number
): (t: number) => string {
  if (spanMs < MS_PER_DAY) {
    return (t) =>
      new Date(t).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
  }
  return (t) =>
    new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
}
