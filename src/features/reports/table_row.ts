// Renders one row of the reports list — the compact summary row of the
// master-detail view. Clicking the row selects the user, which the
// orchestrator handles by rendering the user's full detail into the side
// pane.

import { bonRingChip } from "../../utils/ring_chip.ts";
import { bonReportsVerdictBadge } from "./cell_verdict.ts";
import type { ReportRow } from "./logic.ts";

export interface RowOptions {
  selectedUsername: string | null;
  queueAhead: number;
  onSelect: (username: string) => void;
}

export function bonReportsRow(
  report: ReportRow,
  opts: RowOptions
): HTMLTableRowElement {
  const { selectedUsername, queueAhead, onSelect } = opts;
  const { username, investigation, ringId } = report;

  const summary = document.createElement("tr");
  summary.className = "bon-row-summary";
  if (selectedUsername === username) {
    summary.classList.add("bon-row-summary--selected");
  }

  summary.dataset.bonUsername = username;
  summary.tabIndex = 0;
  summary.setAttribute("role", "button");
  summary.setAttribute(
    "aria-pressed",
    selectedUsername === username ? "true" : "false"
  );

  summary.addEventListener("click", () => onSelect(username));
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(username);
    }
  });

  const userCell = document.createElement("td");
  const nameWrap = document.createElement("span");
  nameWrap.className = "bon-username-cell";

  const linkRow = document.createElement("span");
  linkRow.className = "bon-username-cell-row";

  const link = document.createElement("a");
  link.href = `?user=${encodeURIComponent(username)}`;
  link.textContent = `u/${username}`;
  link.classList.add("bon-pii");

  // Plain click stays in-page via the row's onSelect; the href exists so
  // Cmd/Ctrl-click and right-click "Open in new tab" still work.
  link.addEventListener("click", (event) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect(username);
  });
  linkRow.appendChild(link);

  const ringChip = bonRingChip(ringId);
  if (ringChip) {
    linkRow.appendChild(ringChip);
  }

  nameWrap.appendChild(linkRow);
  userCell.appendChild(nameWrap);
  summary.appendChild(userCell);

  const tagsCell = document.createElement("td");
  tagsCell.className = "bon-tags-cell";

  const tagsRow = document.createElement("div");
  tagsRow.className = "bon-tags-row";

  const verdict = bonReportsVerdictBadge(investigation, !!ringId, queueAhead);
  if (verdict) {
    tagsRow.appendChild(verdict);
  }

  tagsCell.appendChild(tagsRow);
  summary.appendChild(tagsCell);

  return summary;
}
