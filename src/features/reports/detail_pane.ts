// Right-side detail pane of the master-detail view. Composes the
// existing per-user widgets (investigation, activity heatmap) and
// footer delete button into one scrollable column. When no user is
// selected, renders a quiet placeholder so the pane doesn't appear
// broken.

import { bonReportsActivitySection } from "./activity_section.ts";
import {
  bonReportsRenderDeleteButton,
  bonReportsRenderInvestigateButton,
} from "./cell_actions.ts";
import { bonReportsRenderGoogleSearchButton } from "./cell_google_search.ts";
import {
  bonReportsGoogleDossierCountFresh,
  bonReportsGoogleDossierSection,
} from "./google_dossier_section.ts";
import { bonReportsInvestigationDetail } from "./investigation_detail.ts";
import type { ReportRow } from "./logic.ts";
import {
  bonReportsPassiveHarvestCountFresh,
  bonReportsPassiveHarvestSection,
} from "./passive_harvest_section.ts";
import { bonReportsProfileSection } from "./profile_section.ts";
import { bonReportsRegionSection } from "./region_section.ts";
import { bonReportsUserNotesSection } from "./user_notes_section.ts";

export interface DetailPaneOptions {
  expectedDurationMs: number | null;
  queueAhead: number;
  onNoApiKey: () => void;
  onInvestigate: () => void;
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
  const { expectedDurationMs, queueAhead, onNoApiKey, onInvestigate } = opts;
  const { username, investigation, ringId } = report;

  const fragment = document.createDocumentFragment();

  // Combined "new since last analysis" tally across both dossier sources
  // (Google SERP + passive DOM scrape). The button surfaces a single
  // number — operator-facing language stays source-agnostic since the
  // re-investigation incorporates every new item regardless of origin.
  const lastRunAt = investigation?.runAt ?? 0;
  const freshHarvestCount =
    bonReportsGoogleDossierCountFresh(report.googleHarvest, lastRunAt) +
    bonReportsPassiveHarvestCountFresh(report.passiveHarvest, lastRunAt);

  const actions = [
    bonReportsRenderInvestigateButton(username, investigation, {
      expectedDurationMs,
      queueAhead,
      freshHarvestCount,
      onNoApiKey,
      onInvestigate,
    }),
    bonReportsRenderGoogleSearchButton(username),
  ];

  fragment.appendChild(bonReportsProfileSection(report, actions));

  fragment.appendChild(
    bonReportsInvestigationDetail(investigation, !!ringId, {
      expectedDurationMs,
    })
  );

  // Notes are independent of the AI run — show them regardless of
  // investigation state so the operator can record their take even
  // while a (re-)investigation is queued.
  fragment.appendChild(bonReportsUserNotesSection(report));

  // Google dossier sits next to notes because both are operator-curated
  // context (not AI-derived). Returns null when no Google search has been
  // run for this user yet — skips the section entirely.
  const dossier = bonReportsGoogleDossierSection(report);
  if (dossier) {
    fragment.appendChild(dossier);
  }

  // Passive harvest: posts/comments the extension caught in feeds for
  // this hidden-profile user. Returns null when the report has no
  // harvested items yet (the common case until the operator browses
  // somewhere this user has posted).
  const passive = bonReportsPassiveHarvestSection(report);
  if (passive) {
    fragment.appendChild(passive);
  }

  // While a re-investigation is queued/running, the prior activity data
  // and region inference are stale — hide both so the pane reads as
  // "working on it" instead of mixing old derived state with new status.
  const inFlight =
    investigation?.status === "queued" || investigation?.status === "running";

  if (!inFlight) {
    fragment.appendChild(bonReportsRegionSection(report));
    fragment.appendChild(bonReportsActivitySection(report));
  }

  // Delete lives at the very bottom — out of the prominent top-right action
  // strip because deletion is rare and the operator should have to scroll
  // past the dossier before they can reach the button.
  const deleteFooter = document.createElement("div");
  deleteFooter.className = "bon-detail-wrap bon-detail-footer";
  deleteFooter.appendChild(bonReportsRenderDeleteButton(username));
  fragment.appendChild(deleteFooter);

  return fragment;
}
