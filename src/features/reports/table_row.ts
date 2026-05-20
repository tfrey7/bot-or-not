// Renders one row of the reports list — the compact summary row of the
// master-detail view. Clicking the row selects the user, which the
// orchestrator handles by rendering the user's full detail into the side
// pane.

import { bonRingChip } from "../../utils/ring_chip.ts";
import { bonReportsFactorDots } from "./cell_factor_dots.ts";
import { bonReportsPersonaTag } from "./cell_persona.ts";
import { bonReportsRegionBadge } from "./cell_region.ts";
import { bonReportsVerdictBadge } from "./cell_verdict.ts";
import type { ReportRow } from "./logic.ts";

export interface RowOptions {
  selectedUsername: string | null;
  queueAhead: number;
  onSelect: (username: string) => void;
}

type MissingSlot = "region" | "verdict" | "persona";

const MISSING_SLOT_TITLES: Record<MissingSlot, string> = {
  region: "No region inferred",
  verdict: "No AI verdict yet",
  persona: "No persona",
};

function bonReportsMissingSlot(kind: MissingSlot): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `bon-tag-missing bon-tag-missing--${kind}`;
  span.textContent = "—";
  span.title = MISSING_SLOT_TITLES[kind];
  span.setAttribute("aria-label", MISSING_SLOT_TITLES[kind]);
  return span;
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

  // Layout/flex lives on this inner wrapper, not the <td>. Flexing the cell
  // itself breaks vertical-align: middle and confuses border-collapse, which
  // showed up as the jagged row rules and off-center badges.
  const tagsInner = document.createElement("div");
  tagsInner.className = "bon-tags-cell-inner";

  // Always render three slots — region / verdict / persona — so every row
  // has the same scan rhythm and the space-between layout reads cleanly.
  // Missing slots get a muted placeholder.
  const tagsRow = document.createElement("div");
  tagsRow.className = "bon-tags-row";

  tagsRow.appendChild(
    bonReportsRegionBadge(report) ?? bonReportsMissingSlot("region")
  );

  tagsRow.appendChild(
    bonReportsVerdictBadge(investigation, !!ringId, queueAhead) ??
      bonReportsMissingSlot("verdict")
  );

  tagsRow.appendChild(
    bonReportsPersonaTag(investigation?.persona) ??
      bonReportsMissingSlot("persona")
  );

  tagsInner.appendChild(tagsRow);
  tagsInner.appendChild(bonReportsFactorDots(investigation));

  tagsCell.appendChild(tagsInner);
  summary.appendChild(tagsCell);

  return summary;
}
