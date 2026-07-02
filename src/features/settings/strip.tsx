// Compact health strip at the top of the Settings tab. Three small
// metrics — storage used, tracked users, errored investigations — so the
// operator can answer "is my install healthy?" without leaving Settings.
// Stays out of the way; intentionally lighter than the analytics cards.

import { render } from "preact";
import type { ReportRow } from "../redditors";

export function settingsStrip(
  reports: ReportRow[],
  container: HTMLElement
): void {
  render(<SettingsStrip reports={reports} />, container);
}

function SettingsStrip({ reports }: { reports: ReportRow[] }) {
  const bytes = estimateBytes(reports);
  let errored = 0;

  for (const report of reports) {
    if (report.investigation?.status === "error") {
      errored += 1;
    }
  }

  return (
    <div class="bon-settings-strip">
      <Stat label="Storage" value={formatBytes(bytes)} />
      <Stat label="Tracked users" value={String(reports.length)} />
      <Stat label="Errors" value={String(errored)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="bon-settings-strip-stat">
      <div class="bon-settings-strip-label">{label}</div>
      <div class="bon-settings-strip-value">{value}</div>
    </div>
  );
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
