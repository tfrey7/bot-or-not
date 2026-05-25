// Right-side detail pane of the master-detail view. Composes the
// existing per-user widgets (investigation, activity heatmap) and
// footer delete button into one scrollable column. When no user is
// selected, renders a quiet placeholder so the pane doesn't appear
// broken.

import { investigationResults } from "../../utils/history.ts";
import { redditorsActivitySection } from "./activity_section.ts";
import {
  redditorsRenderDeleteButton,
  redditorsRenderInvestigateButton,
} from "./cell_actions.ts";
import { redditorsRenderGoogleSearchButton } from "./cell_google_search.ts";
import {
  redditorsGoogleDossierCountFresh,
  redditorsGoogleDossierSection,
} from "./google_dossier_section.ts";
import { redditorsInvestigationDetail } from "./investigation_detail.ts";
import { redditorsIsUserNotFoundError } from "./investigation_user_not_found.ts";
import type { ReportRow } from "./logic.ts";
import {
  redditorsPassiveHarvestCountFresh,
  redditorsPassiveHarvestSection,
} from "./passive_harvest_section.ts";
import { redditorsProfileSection } from "./profile_section.ts";
import { redditorsUserNotesSection } from "./user_notes_section.ts";

export interface DetailPaneOptions {
  expectedDurationMs: number | null;
  queueAhead: number;
  onNoApiKey: () => void;
  onInvestigate: () => void;
}

export function redditorsDetailEmpty(message: string): HTMLDivElement {
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

export function redditorsDetailPane(
  report: ReportRow,
  opts: DetailPaneOptions
): DocumentFragment {
  const { expectedDurationMs, queueAhead, onNoApiKey, onInvestigate } = opts;
  const { username, investigation, ringId } = report;

  const fragment = document.createDocumentFragment();

  // When Reddit said the user doesn't exist, re-running the investigation
  // will just hit 404 again — hide the Investigate button, the notes form,
  // and the activity/region placeholders that imply a future run will fill
  // them in. Google search stays useful (the operator might want to verify
  // the username they typed, or hunt for a deleted account elsewhere).
  const userNotFound =
    investigation?.status === "error" &&
    redditorsIsUserNotFoundError(investigation.error);

  // Combined "new since last analysis" tally across both dossier sources
  // (Google SERP + passive DOM scrape). The button surfaces a single
  // number — operator-facing language stays source-agnostic since the
  // re-investigation incorporates every new item regardless of origin.
  const lastRunAt = investigationResults(investigation)?.runAt ?? 0;
  const freshHarvestCount =
    redditorsGoogleDossierCountFresh(report.googleHarvest, lastRunAt) +
    redditorsPassiveHarvestCountFresh(report.passiveHarvest, lastRunAt);

  const actions = userNotFound
    ? [redditorsRenderGoogleSearchButton(username)]
    : [
        redditorsRenderInvestigateButton(username, investigation, {
          expectedDurationMs,
          queueAhead,
          freshHarvestCount,
          onNoApiKey,
          onInvestigate,
        }),
        redditorsRenderGoogleSearchButton(username),
      ];

  fragment.appendChild(redditorsProfileSection(report, actions));

  fragment.appendChild(
    redditorsInvestigationDetail(investigation, !!ringId, {
      expectedDurationMs,
      username,
    })
  );

  if (!userNotFound) {
    // Google dossier — operator-curated context (not AI-derived). Returns
    // null when no Google search has been run for this user yet.
    const dossier = redditorsGoogleDossierSection(report);
    if (dossier) {
      fragment.appendChild(dossier);
    }

    // Passive harvest: posts/comments the extension caught in feeds for
    // this hidden-profile user. Returns null when the report has no
    // harvested items yet (the common case until the operator browses
    // somewhere this user has posted).
    const passive = redditorsPassiveHarvestSection(report);
    if (passive) {
      fragment.appendChild(passive);
    }

    // While a re-investigation is queued/running, the prior activity data
    // is stale — hide it so the pane reads as "working on it" instead of
    // mixing old derived state with new status.
    const inFlight =
      investigation?.status === "queued" || investigation?.status === "running";

    if (!inFlight) {
      fragment.appendChild(redditorsActivitySection(report));
    }

    // Notes sit at the bottom so the AI signals + dossier + activity all
    // sit above the operator's hand-written take. Independent of the AI
    // run — show them regardless of investigation state so the operator
    // can record their take while a (re-)investigation is queued.
    fragment.appendChild(redditorsUserNotesSection(report));
  }

  // Delete lives at the very bottom — out of the prominent top-right action
  // strip because deletion is rare and the operator should have to scroll
  // past the dossier before they can reach the button.
  const deleteFooter = document.createElement("div");
  deleteFooter.className = "bon-detail-wrap bon-detail-footer";
  deleteFooter.appendChild(redditorsRenderDeleteButton(username));
  fragment.appendChild(deleteFooter);

  return fragment;
}
