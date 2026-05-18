// "Investigated" column cell. Shows the elapsed timer while a run is in
// flight (refreshed in place by the poll tick), the stalled state when
// orphaned, or the date + duration once a run completes.

import { bonFmtDuration, bonFormatDate } from "../../utils/format_time.js";
import { bonIsInvestigationStale } from "../../verdict.js";
import { bonReportsFormatRunningCellText } from "./logic.js";

export function bonReportsPopulateInvestigatedCell(
  cell,
  investigation,
  expectedDurationMs
) {
  if (!investigation || (!investigation.runAt && !investigation.startedAt)) {
    cell.textContent = "—";
    cell.classList.add("bon-cell-muted");
    return;
  }
  if (investigation.status === "running") {
    const stale = bonIsInvestigationStale(investigation);
    if (stale) {
      cell.textContent = "Stalled";
    } else if (investigation.startedAt) {
      const elapsed = Math.max(
        0,
        Math.round((Date.now() - investigation.startedAt) / 1000)
      );
      cell.textContent = bonReportsFormatRunningCellText(
        elapsed,
        expectedDurationMs
      );
    } else {
      cell.textContent = "Running…";
    }
    if (investigation.startedAt) {
      const started = new Date(investigation.startedAt).toLocaleString();
      cell.title = stale
        ? `Stalled — started ${started}, never completed`
        : `Started ${started}`;
    }
    return;
  }
  const when = document.createElement("span");
  when.textContent = investigation.runAt
    ? bonFormatDate(investigation.runAt)
    : "—";
  if (investigation.runAt) {
    when.title = new Date(investigation.runAt).toLocaleString();
  }
  cell.appendChild(when);
  if (typeof investigation.durationMs === "number") {
    const dur = document.createElement("span");
    dur.className = "bon-duration";
    dur.textContent = `Took ${bonFmtDuration(investigation.durationMs)}`;
    cell.appendChild(dur);
  }
}
