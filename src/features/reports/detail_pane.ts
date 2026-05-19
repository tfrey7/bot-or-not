// Right-side detail pane of the master-detail view. Composes the
// existing per-user widgets (investigation, activity heatmap, report
// history) and footer delete button into one scrollable column. When
// no user is selected, renders a quiet placeholder so the pane doesn't
// appear broken.

import type { ActivityData } from "../../types.ts";
import {
  bonReportsActivityLoadingPlaceholder,
  bonReportsActivitySection,
} from "./activity_section.ts";
import {
  bonReportsRenderDeleteButton,
  bonReportsRenderInvestigateButton,
} from "./cell_actions.ts";
import { bonReportsHistoryTable } from "./history_table.ts";
import { bonReportsInvestigationDetail } from "./investigation_detail.ts";
import type { ReportRow } from "./logic.ts";
import { bonReportsProfileSection } from "./profile_section.ts";
import { bonReportsRegionSection } from "./region_section.ts";

export interface DetailPaneOptions {
  inflightActivity: Set<string>;
  expectedDurationMs: number | null;
  onActivityNeedsLoad: (
    username: string,
    activityData: ActivityData | null
  ) => Promise<void> | void;
  onNoApiKey: () => void;
}

export function bonReportsDetailEmpty(message: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-empty";

  const icon = document.createElement("div");
  icon.className = "bon-detail-empty-icon";
  icon.textContent = "🔍";
  wrap.appendChild(icon);

  const text = document.createElement("p");
  text.className = "bon-empty-text";
  text.textContent = message;
  wrap.appendChild(text);

  return wrap;
}

export function bonReportsDetailPane(
  report: ReportRow,
  opts: DetailPaneOptions
): DocumentFragment {
  const {
    inflightActivity,
    expectedDurationMs,
    onActivityNeedsLoad,
    onNoApiKey,
  } = opts;
  const { username, history, investigation, activityData, ringId } = report;

  const fragment = document.createDocumentFragment();

  fragment.appendChild(bonReportsProfileSection(report));

  const actions = [
    bonReportsRenderInvestigateButton(username, investigation, {
      expectedDurationMs,
      onNoApiKey,
    }),
    bonReportsRenderDeleteButton(username),
  ];

  fragment.appendChild(
    bonReportsInvestigationDetail(investigation, actions, !!ringId, {
      expectedDurationMs,
    })
  );

  fragment.appendChild(bonReportsRegionSection(report));

  if (inflightActivity.has(username) && !activityData) {
    fragment.appendChild(bonReportsActivityLoadingPlaceholder());
  } else {
    fragment.appendChild(bonReportsActivitySection(report));
  }

  void onActivityNeedsLoad(username, activityData);

  if (history && history.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "bon-detail-wrap";

    const title = document.createElement("p");
    title.className = "bon-detail-title";
    title.textContent = "Report history";
    wrap.appendChild(title);

    wrap.appendChild(bonReportsHistoryTable(history));
    fragment.appendChild(wrap);
  }

  return fragment;
}
