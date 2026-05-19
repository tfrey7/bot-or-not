// Renders one row of the reports list — the compact summary row of the
// master-detail view. Clicking the row selects the user, which the
// orchestrator handles by rendering the user's full detail into the side
// pane.

import { bonRingChip } from "../../utils/ring_chip.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsFactorDots } from "./cell_factor_dots.ts";
import { bonReportsPopulateInvestigatedCell } from "./cell_investigated.ts";
import { bonReportsRegionBadge } from "./cell_region.ts";
import { bonReportsVerdictBadge } from "./cell_verdict.ts";
import type { ReportRow } from "./logic.ts";

export interface RowOptions {
  selectedUsername: string | null;
  expectedDurationMs: number | null;
  isChecked: boolean;
  onSelect: (username: string) => void;
  onToggleCheck: (username: string, checked: boolean) => void;
}

export function bonReportsRow(
  report: ReportRow,
  opts: RowOptions
): HTMLTableRowElement {
  const {
    selectedUsername,
    expectedDurationMs,
    isChecked,
    onSelect,
    onToggleCheck,
  } = opts;
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

  const selectCell = document.createElement("td");
  selectCell.className = "bon-row-select-cell";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isChecked;
  checkbox.setAttribute("aria-label", `Select u/${username}`);
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  checkbox.addEventListener("change", () => {
    onToggleCheck(username, checkbox.checked);
  });
  selectCell.appendChild(checkbox);
  summary.appendChild(selectCell);

  const userCell = document.createElement("td");
  const nameWrap = document.createElement("span");
  nameWrap.className = "bon-username-cell";

  const linkRow = document.createElement("span");
  linkRow.className = "bon-username-cell-row";

  const link = document.createElement("a");
  link.href = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `u/${username}`;
  linkRow.appendChild(link);

  const ringChip = bonRingChip(ringId);
  if (ringChip) {
    linkRow.appendChild(ringChip);
  }

  nameWrap.appendChild(linkRow);
  nameWrap.appendChild(bonReportsFactorDots(investigation));
  userCell.appendChild(nameWrap);
  summary.appendChild(userCell);

  const regionCell = document.createElement("td");
  regionCell.className = "bon-region-cell";
  regionCell.appendChild(bonReportsRegionBadge(report));
  summary.appendChild(regionCell);

  const verdictCell = document.createElement("td");
  const verdictBadge = bonReportsVerdictBadge(investigation, !!ringId);
  if (verdictBadge) {
    verdictCell.appendChild(verdictBadge);
  } else {
    const dash = document.createElement("span");
    dash.className = "bon-bb-empty";
    dash.textContent = "—";
    verdictCell.appendChild(dash);
  }
  summary.appendChild(verdictCell);

  const investigatedCell = document.createElement("td");
  investigatedCell.className = "bon-investigated-cell";
  bonReportsPopulateInvestigatedCell(
    investigatedCell,
    investigation,
    expectedDurationMs
  );
  if (
    investigation?.status === "running" &&
    !bonIsInvestigationStale(investigation)
  ) {
    investigatedCell.dataset.bonRunningCell = username;
  }
  summary.appendChild(investigatedCell);

  return summary;
}
