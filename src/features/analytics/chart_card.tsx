// Card chrome shared by every analytics panel: titled header + body.
// UplotCard is the variant for the uplot charts — the chart itself comes
// from a vanilla builder, mounted via a ref; the builder reference is
// module-stable, so the effect refires only when the runs array changes.

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { AnalyticsEntry } from "./logic.ts";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ComponentChildren;
}

export function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <div class="bon-chart-card">
      <div class="bon-chart-head">
        <div class="bon-chart-title">{title}</div>
        {subtitle && <div class="bon-chart-sub">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export interface UplotCardProps {
  title: string;
  subtitle?: string;
  runs: AnalyticsEntry[];
  build: (runs: AnalyticsEntry[]) => HTMLElement;
}

export function UplotCard({ title, subtitle, runs, build }: UplotCardProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    host.current?.replaceChildren(build(runs));
  }, [build, runs]);

  return (
    <ChartCard title={title} subtitle={subtitle}>
      <div ref={host} />
    </ChartCard>
  );
}
