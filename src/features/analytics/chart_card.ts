// Card wrapper that surrounds each chart widget with a titled header.
// Used by the orchestrator (index.js) to wrap chart SVGs.

export function bonAnalyticsChartCard(
  title: string,
  subtitle: string | null,
  contentEl: Node
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "bon-chart-card";
  const head = document.createElement("div");
  head.className = "bon-chart-head";
  const h = document.createElement("div");
  h.className = "bon-chart-title";
  h.textContent = title;
  head.appendChild(h);
  if (subtitle) {
    const s = document.createElement("div");
    s.className = "bon-chart-sub";
    s.textContent = subtitle;
    head.appendChild(s);
  }
  card.appendChild(head);
  card.appendChild(contentEl);
  return card;
}
