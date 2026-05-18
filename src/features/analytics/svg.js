// SVG helpers shared by the analytics chart widgets. Pure DOM builders;
// no business logic.

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MS_PER_DAY = 86_400_000;

  function bonAnalyticsSvgRoot(w, h, classes) {
    const el = document.createElementNS(SVG_NS, "svg");
    el.setAttribute("viewBox", `0 0 ${w} ${h}`);
    el.setAttribute("preserveAspectRatio", "none");
    el.setAttribute("class", classes || "bon-chart-svg");
    return el;
  }

  function bonAnalyticsSvgEl(name, attrs) {
    const e = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        e.setAttribute(k, v);
      }
    }
    return e;
  }

  function bonAnalyticsSvgText(x, y, text, cls, anchor) {
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

  function bonAnalyticsEmptyChart(w, h, text) {
    return bonAnalyticsSvgText(w / 2, h / 2, text, "bon-chart-empty", "middle");
  }

  // Picks date vs. time-of-day formatting based on how much wall-clock the
  // chart actually spans, so axes stay informative whether the runs are spread
  // across weeks or clustered in a single afternoon.
  function bonAnalyticsTimeAxisFormatter(spanMs) {
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

  globalThis.bonAnalyticsSvgRoot = bonAnalyticsSvgRoot;
  globalThis.bonAnalyticsSvgEl = bonAnalyticsSvgEl;
  globalThis.bonAnalyticsSvgText = bonAnalyticsSvgText;
  globalThis.bonAnalyticsEmptyChart = bonAnalyticsEmptyChart;
  globalThis.bonAnalyticsTimeAxisFormatter = bonAnalyticsTimeAxisFormatter;
})();
