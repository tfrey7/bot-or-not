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
import { bonReportsGoogleDossierSection } from "./google_dossier_section.ts";
import { bonReportsInvestigationDetail } from "./investigation_detail.ts";
import type { ReportRow } from "./logic.ts";
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

  const actions = [
    bonReportsRenderInvestigateButton(username, investigation, {
      expectedDurationMs,
      queueAhead,
      onNoApiKey,
      onInvestigate,
    }),
    bonReportsRenderGoogleSearchButton(username),
    bonReportsRenderDeleteButton(username),
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

  // While a re-investigation is queued/running, the prior activity data
  // and region inference are stale — hide both so the pane reads as
  // "working on it" instead of mixing old derived state with new status.
  const inFlight =
    investigation?.status === "queued" || investigation?.status === "running";

  if (!inFlight) {
    fragment.appendChild(bonReportsRegionSection(report));
    fragment.appendChild(bonReportsActivitySection(report));
  }

  return fragment;
}
