// Compact health strip at the top of the Settings tab. Three small
// metrics — storage used, tracked users, errored investigations — so the
// operator can answer "is my install healthy?" without leaving Settings.
// Stays out of the way; intentionally lighter than the analytics cards.

import type { ReportRow } from "../redditors";

export function bonSettingsStrip(
  reports: ReportRow[],
  container: HTMLElement
): void {
  const bytes = estimateBytes(reports);
  let errored = 0;

  for (const report of reports) {
    if (report.investigation?.status === "error") {
      errored += 1;
    }
  }

  container.replaceChildren();

  const strip = document.createElement("div");
  strip.className = "bon-settings-strip";

  strip.appendChild(buildStat("Storage", formatBytes(bytes)));
  strip.appendChild(buildStat("Tracked users", String(reports.length)));
  strip.appendChild(buildStat("Errors", String(errored)));

  container.appendChild(strip);
}

function buildStat(label: string, value: string): HTMLDivElement {
  const stat = document.createElement("div");
  stat.className = "bon-settings-strip-stat";

  const labelEl = document.createElement("div");
  labelEl.className = "bon-settings-strip-label";
  labelEl.textContent = label;
  stat.appendChild(labelEl);

  const valueEl = document.createElement("div");
  valueEl.className = "bon-settings-strip-value";
  valueEl.textContent = value;
  stat.appendChild(valueEl);

  return stat;
}

// Rough UTF-8 byte estimate from the JSON serialization — same approach
// the diagnostics tab used. browser.storage.local.getBytesInUse isn't
// uniformly supported across Firefox versions.
function estimateBytes(reports: ReportRow[]): number {
  try {
    const map: Record<string, ReportRow> = {};

    for (const report of reports) {
      map[report.username] = report;
    }

    const json = JSON.stringify(map);
    return json ? new Blob([json]).size : 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
