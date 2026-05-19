// SVG helpers shared by the analytics chart widgets. Pure DOM builders;
// no business logic.

const SVG_NS = "http://www.w3.org/2000/svg";
const MS_PER_DAY = 86_400_000;

export function bonAnalyticsSvgRoot(
  w: number,
  h: number,
  classes?: string
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", classes || "bon-chart-svg");
  return svg;
}

export function bonAnalyticsSvgEl(
  name: string,
  attrs?: Record<string, string | number>
): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const [attrName, attrValue] of Object.entries(attrs)) {
      element.setAttribute(attrName, String(attrValue));
    }
  }
  return element;
}

export function bonAnalyticsSvgText(
  x: number,
  y: number,
  text: string,
  className?: string | null,
  anchor?: string | null
): SVGElement {
  const textEl = bonAnalyticsSvgEl("text", {
    x,
    y,
    class: className || "bon-chart-tick",
  });

  if (anchor) {
    textEl.setAttribute("text-anchor", anchor);
  }

  textEl.textContent = text;
  return textEl;
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
): (timestamp: number) => string {
  if (spanMs < MS_PER_DAY) {
    return (timestamp) =>
      new Date(timestamp).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
  }
  return (timestamp) =>
    new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
}
