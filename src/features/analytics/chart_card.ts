// Card wrapper that surrounds each chart widget with a titled header.
// Used by the orchestrator (index.js) to wrap chart SVGs.

export function analyticsChartCard(
  title: string,
  subtitle: string | null,
  contentEl: Node
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "bon-chart-card";

  const head = document.createElement("div");
  head.className = "bon-chart-head";

  const titleEl = document.createElement("div");
  titleEl.className = "bon-chart-title";
  titleEl.textContent = title;
  head.appendChild(titleEl);

  if (subtitle) {
    const subtitleEl = document.createElement("div");
    subtitleEl.className = "bon-chart-sub";
    subtitleEl.textContent = subtitle;
    head.appendChild(subtitleEl);
  }

  card.appendChild(head);
  card.appendChild(contentEl);
  return card;
}
