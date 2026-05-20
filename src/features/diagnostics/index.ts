// Diagnostics tab — human-friendly view of browser.storage.local. Reads the
// reports map already loaded by the reports orchestrator, summarizes it,
// and renders a stack of widgets: storage overview, state-breakdown
// tables, recent-errors list, per-record inspector.

import type { Report } from "../../types.ts";
import { bonDiagnosticsErrorList } from "./error_list.ts";
import { bonDiagnosticsSummarize } from "./logic.ts";
import { bonDiagnosticsQueueState } from "./queue_state.ts";
import {
  bonDiagnosticsRecordInspector,
  type InspectorState,
} from "./record_inspector.ts";
import { bonDiagnosticsStateBreakdown } from "./state_breakdown.ts";
import { bonDiagnosticsStorageOverview } from "./storage_overview.ts";

export interface DiagnosticsOptions {
  apiKeySet: boolean;
}

// Inspector selection lives outside the render call so it survives the
// frequent re-paints triggered by storage.onChanged.
const inspectorState: InspectorState = { selectedUsername: null };

export function bonRenderDiagnostics(
  reports: Record<string, Report>,
  container: HTMLElement | null,
  options: DiagnosticsOptions
): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "bon-analytics bon-diagnostics";
  section.appendChild(buildHeader(Object.keys(reports).length));

  const summary = bonDiagnosticsSummarize(reports, options.apiKeySet);
  section.appendChild(bonDiagnosticsStorageOverview(summary));
  section.appendChild(bonDiagnosticsQueueState(summary));
  section.appendChild(bonDiagnosticsStateBreakdown(summary));

  const errors = bonDiagnosticsErrorList(summary.recentErrors);
  if (errors) {
    section.appendChild(errors);
  }

  section.appendChild(bonDiagnosticsRecordInspector(reports, inspectorState));

  container.appendChild(section);
}

function buildHeader(totalRecords: number): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-analytics-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Diagnostics";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-analytics-subtitle";
  sub.textContent =
    totalRecords === 0
      ? "Browser storage is empty."
      : `What's in browser.storage.local — ${totalRecords} record${totalRecords === 1 ? "" : "s"}.`;
  header.appendChild(sub);

  return header;
}
