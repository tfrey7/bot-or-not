// Renders one row of the reports list — the compact summary row of the
// master-detail view. Clicking the row selects the user, which the
// orchestrator handles by rendering the user's full detail into the side
// pane.

import { bonRingChip } from "../../utils/ring_chip.ts";
import { bonReportsPersonaTag } from "./cell_persona.ts";
import { bonReportsRegionBadge } from "./cell_region.ts";
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
  userCell.appendChild(nameWrap);
  summary.appendChild(userCell);

  const tagsCell = document.createElement("td");
  tagsCell.className = "bon-tags-cell";

  const tagsRow = document.createElement("div");
  tagsRow.className = "bon-tags-row";

  const region = bonReportsRegionBadge(report);
  if (region) {
    tagsRow.appendChild(region);
  }

  const verdict = bonReportsVerdictBadge(investigation, !!ringId, queueAhead);
  if (verdict) {
    tagsRow.appendChild(verdict);
  }

  const persona = bonReportsPersonaTag(
    investigation?.status === "done" ? investigation.results.persona : null
  );

  if (persona) {
    tagsRow.appendChild(persona);
  }

  tagsCell.appendChild(tagsRow);
  summary.appendChild(tagsCell);

  return summary;
}
