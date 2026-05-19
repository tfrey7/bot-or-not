// Top-of-diagnostics stat grid — storage usage, record count, time bounds,
// API-key state.

import { bonFormatDate } from "../../utils/format_time.ts";
import { bonDiagnosticsFormatBytes, type DiagnosticsSummary } from "./logic.ts";

export function bonDiagnosticsStorageOverview(
  summary: DiagnosticsSummary
): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = "bon-analytics-stats";

  addStat(
    grid,
    "Storage used",
    bonDiagnosticsFormatBytes(summary.estimatedBytes),
    "estimated from serialized JSON"
  );
  addStat(
    grid,
    "Tracked users",
    String(summary.totalRecords),
    summary.totalRecords === 0 ? "no reports yet" : "in browser.storage.local"
  );
  addStat(
    grid,
    "Claude API key",
    summary.apiKeySet ? "Configured" : "Not set",
    summary.apiKeySet ? "stored locally" : "open Settings to add one"
  );
  addStat(
    grid,
    "Oldest report",
    summary.oldestReportedAt ? bonFormatDate(summary.oldestReportedAt) : "—",
    summary.newestReportedAt
      ? `latest ${bonFormatDate(summary.newestReportedAt)}`
      : ""
  );

  return grid;
}

function addStat(
  parent: HTMLElement,
  label: string,
  value: string,
  sub?: string
): void {
  const card = document.createElement("div");
  card.className = "bon-analytics-stat";

  const labelEl = document.createElement("div");
  labelEl.className = "bon-stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "bon-stat-value";
  valueEl.textContent = value;

  card.appendChild(labelEl);
  card.appendChild(valueEl);

  if (sub) {
    const subEl = document.createElement("div");
    subEl.className = "bon-stat-sub";
    subEl.textContent = sub;
    card.appendChild(subEl);
  }

  parent.appendChild(card);
}
