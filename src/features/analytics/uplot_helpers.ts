// Shared scaffolding for the uplot-based analytics charts: host/tooltip
// builder, palette lookup against the --bon-* CSS vars, default axes config,
// and a ResizeObserver that keeps the chart full-width.

import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const CHART_HEIGHT = 200;

export type UplotChartOptions = Omit<uPlot.Options, "width" | "height"> & {
  width?: number;
  height?: number;
};

export interface UplotHost {
  host: HTMLDivElement;
  tooltip: HTMLDivElement;
  mount(opts: UplotChartOptions, data: uPlot.AlignedData): uPlot;
}

export function analyticsUplotPalette(): {
  accent: string;
  accentSoft: string;
  rust: string;
  forest: string;
  amber: string;
  red: string;
  muted: string;
  mutedSoft: string;
  border: string;
  borderStrong: string;
  text: string;
  surface: string;
} {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name).trim();
  return {
    accent: read("--bon-accent"),
    accentSoft: read("--bon-accent-soft"),
    rust: read("--bon-stamp-rust"),
    forest: read("--bon-stamp-forest"),
    amber: read("--bon-stamp-amber"),
    red: read("--bon-stamp-red"),
    muted: read("--bon-muted"),
    mutedSoft: read("--bon-muted-soft"),
    border: read("--bon-border"),
    borderStrong: read("--bon-border-strong"),
    text: read("--bon-text"),
    surface: read("--bon-surface"),
  };
}

export function analyticsUplotHost(): UplotHost {
  const host = document.createElement("div");
  host.className = "bon-analytics-uplot";

  const tooltip = document.createElement("div");
  tooltip.className = "bon-analytics-uplot-tooltip";
  tooltip.hidden = true;
  host.appendChild(tooltip);

  return {
    host,
    tooltip,
    mount(opts, data) {
      const finalOpts = {
        ...opts,
        width: opts.width ?? host.clientWidth ?? 600,
        height: opts.height ?? CHART_HEIGHT,
      } as uPlot.Options;

      const plot = new uPlot(finalOpts, data, host);

      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = Math.floor(entry.contentRect.width);
          if (width > 0 && width !== plot.width) {
            plot.setSize({ width, height: finalOpts.height as number });
          }
        }
      });

      ro.observe(host);
      return plot;
    },
  };
}

// Standard axis config used across the charts. The y axis variant keeps the
// fixed-width gutter so cards in the analytics grid line up vertically.
//
// xIncrs override: for daily-bucketed charts (one bar/dot per day), pass
// `[86400]` so uplot picks day-boundary ticks instead of also drawing the
// midday tick uplot's default time axis emits at narrow widths.
export function analyticsAxes(
  palette: ReturnType<typeof analyticsUplotPalette>,
  overrides: {
    xValues?: uPlot.Axis.Values;
    xIncrs?: uPlot.Axis.Incrs;
    yValues?: uPlot.Axis.Values;
  } = {}
): uPlot.Axis[] {
  return [
    {
      stroke: palette.muted,
      grid: { show: false },
      ticks: { show: true, stroke: palette.border, width: 1, size: 4 },
      border: { show: true, stroke: palette.border, width: 1 },
      font: "10px ui-monospace, SFMono-Regular, Menlo, monospace",
      ...(overrides.xValues ? { values: overrides.xValues } : {}),
      ...(overrides.xIncrs ? { incrs: overrides.xIncrs } : {}),
    },
    {
      stroke: palette.muted,
      grid: { show: true, stroke: palette.border, width: 1, dash: [2, 3] },
      ticks: { show: true, stroke: palette.border, width: 1, size: 4 },
      border: { show: true, stroke: palette.border, width: 1 },
      size: 48,
      font: "10px ui-monospace, SFMono-Regular, Menlo, monospace",
      ...(overrides.yValues ? { values: overrides.yValues } : {}),
    },
  ];
}

// Empty-state placeholder. Keeps the chart card the same height as a populated
// chart so the grid layout doesn't shuffle when one panel has no data.
export function analyticsEmptyPanel(text: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-uplot bon-analytics-uplot--empty";

  const label = document.createElement("span");
  label.className = "bon-analytics-uplot-empty-label";
  label.textContent = text;
  wrap.appendChild(label);
  return wrap;
}

// Positions the tooltip div near the cursor without overflowing the host
// rectangle. Reused by every chart so the hover behaviour matches.
export function analyticsPlaceTooltip(
  host: HTMLDivElement,
  tooltip: HTMLDivElement,
  overLeft: number,
  overTop: number,
  cursorLeft: number,
  cursorTop: number
): void {
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const hostWidth = host.clientWidth;
  const hostHeight = host.clientHeight;

  let posX = overLeft + cursorLeft + 14;

  if (posX + tooltipWidth > hostWidth - 4) {
    posX = overLeft + cursorLeft - tooltipWidth - 14;
  }

  let posY = overTop + cursorTop + 12;

  if (posY + tooltipHeight > hostHeight - 4) {
    posY = overTop + cursorTop - tooltipHeight - 12;
  }

  tooltip.style.left = `${Math.max(4, posX)}px`;
  tooltip.style.top = `${Math.max(4, posY)}px`;
}

export const ANALYTICS_CHART_HEIGHT = CHART_HEIGHT;
