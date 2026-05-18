// Renders one row of the reports table (summary row + collapsible detail
// rows for investigation / activity heatmap / report history). The summary
// row's expand caret manages its own expanded/collapsed state, mirrored
// up to the orchestrator's `expanded` set so it survives re-renders.

import type { ActivityData } from "../../types.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import {
  bonReportsActivityLoadingPlaceholder,
  bonReportsActivitySection,
} from "./activity_section.ts";
import {
  bonReportsRenderDeleteButton,
  bonReportsRenderInvestigateButton,
} from "./cell_actions.ts";
import { bonReportsFactorDots } from "./cell_factor_dots.ts";
import { bonReportsPopulateInvestigatedCell } from "./cell_investigated.ts";
import { bonReportsRegionBadge } from "./cell_region.ts";
import { bonReportsVerdictBadge } from "./cell_verdict.ts";
import { bonReportsHistoryTable } from "./history_table.ts";
import { bonReportsInvestigationDetail } from "./investigation_detail.ts";
import { bonReportsIsActivityFresh, type ReportRow } from "./logic.ts";

export interface RowOptions {
  expanded: Set<string>;
  expectedDurationMs: number | null;
  inflightActivity: Set<string>;
  onNoApiKey: () => void;
  onActivityNeedsLoad: (
    username: string,
    activityData: ActivityData | null | undefined
  ) => Promise<void> | void;
}

export interface RowResult {
  summary: HTMLTableRowElement;
  detailRows: HTMLTableRowElement[];
}

export function bonReportsRow(report: ReportRow, opts: RowOptions): RowResult {
  const {
    expanded,
    expectedDurationMs,
    inflightActivity,
    onNoApiKey,
    onActivityNeedsLoad,
  } = opts;
  const { username, lastReportedAt, history, investigation } = report;

  const summary = document.createElement("tr");
  summary.className = "bon-row-summary";

  const hasHistory = history && history.length > 0;
  const hasInvestigation =
    !!investigation &&
    (investigation.verdict ||
      investigation.status === "error" ||
      investigation.status === "running");

  const detailRows: HTMLTableRowElement[] = [];
  let activityCellRef: HTMLTableCellElement | null = null;

  const expandCell = document.createElement("td");
  const expandBtn = document.createElement("button");
  expandBtn.className = "bon-expand-btn";
  expandBtn.setAttribute(
    "aria-expanded",
    expanded.has(username) ? "true" : "false"
  );
  expandBtn.setAttribute("aria-label", "Show details");
  expandBtn.textContent = "▶";
  expandBtn.addEventListener("click", () => {
    const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
    const next = !isExpanded;
    expandBtn.setAttribute("aria-expanded", String(next));
    for (const row of detailRows) {
      row.hidden = !next;
    }
    if (next) {
      expanded.add(username);
      if (
        activityCellRef &&
        !bonReportsIsActivityFresh(report.activityData) &&
        !inflightActivity.has(username)
      ) {
        if (!report.activityData) {
          activityCellRef.replaceChildren(
            bonReportsActivityLoadingPlaceholder()
          );
        }
        void onActivityNeedsLoad(username, report.activityData);
      }
    } else {
      expanded.delete(username);
    }
  });
  expandCell.appendChild(expandBtn);
  summary.appendChild(expandCell);

  const userCell = document.createElement("td");
  const nameWrap = document.createElement("span");
  nameWrap.className = "bon-username-cell";
  const link = document.createElement("a");
  link.href = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `u/${username}`;
  nameWrap.appendChild(link);
  userCell.appendChild(nameWrap);
  summary.appendChild(userCell);

  const regionCell = document.createElement("td");
  regionCell.className = "bon-region-cell";
  regionCell.appendChild(bonReportsRegionBadge(report));
  summary.appendChild(regionCell);

  const verdictCell = document.createElement("td");
  const verdictEl = bonReportsVerdictBadge(investigation);
  if (verdictEl) {
    verdictCell.appendChild(verdictEl);
  } else {
    const dash = document.createElement("span");
    dash.className = "bon-bb-empty";
    dash.textContent = "—";
    verdictCell.appendChild(dash);
  }
  summary.appendChild(verdictCell);

  const factorsCell = document.createElement("td");
  factorsCell.appendChild(bonReportsFactorDots(investigation));
  summary.appendChild(factorsCell);

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

  const dateCell = document.createElement("td");
  dateCell.className = "bon-cell-muted";
  if (lastReportedAt) {
    dateCell.textContent = bonFormatDate(lastReportedAt);
    dateCell.title = new Date(lastReportedAt).toLocaleString();
  } else {
    dateCell.textContent = "—";
  }
  summary.appendChild(dateCell);

  const actionsCell = document.createElement("td");
  actionsCell.className = "bon-actions-cell";
  actionsCell.appendChild(
    bonReportsRenderInvestigateButton(username, investigation, {
      expectedDurationMs,
      onNoApiKey,
    })
  );
  actionsCell.appendChild(bonReportsRenderDeleteButton(username));
  summary.appendChild(actionsCell);

  const startCollapsed = !expanded.has(username);

  if (hasInvestigation && investigation) {
    const investigationRow = document.createElement("tr");
    investigationRow.className = "bon-row-history";
    investigationRow.hidden = startCollapsed;
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.appendChild(bonReportsInvestigationDetail(investigation));
    investigationRow.appendChild(cell);
    detailRows.push(investigationRow);
  }

  {
    const activityRow = document.createElement("tr");
    activityRow.className = "bon-row-history";
    activityRow.hidden = startCollapsed;
    const activityCell = document.createElement("td");
    activityCell.colSpan = 8;
    if (inflightActivity.has(username) && !report.activityData) {
      activityCell.appendChild(bonReportsActivityLoadingPlaceholder());
    } else {
      activityCell.appendChild(bonReportsActivitySection(report));
    }
    activityRow.appendChild(activityCell);
    detailRows.push(activityRow);
    activityCellRef = activityCell;
  }

  if (hasHistory) {
    const historyRow = document.createElement("tr");
    historyRow.className = "bon-row-history";
    historyRow.hidden = startCollapsed;
    const historyCell = document.createElement("td");
    historyCell.colSpan = 8;
    const wrap = document.createElement("div");
    wrap.className = "bon-detail-wrap";
    const title = document.createElement("p");
    title.className = "bon-detail-title";
    title.textContent = "Report history";
    wrap.appendChild(title);
    wrap.appendChild(bonReportsHistoryTable(history));
    historyCell.appendChild(wrap);
    historyRow.appendChild(historyCell);
    detailRows.push(historyRow);
  }

  return { summary, detailRows };
}
