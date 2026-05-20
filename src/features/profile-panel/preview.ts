// The always-visible preview block between the panel header and the
// collapsible body. Mirrors the reports detail pane: persona card (label
// + radar + summary) on the LEFT, HUMAN/BOT signals list on the RIGHT.
// Returns null when there's no investigation to preview so the panel can
// fall back to a single bare toggle row.

import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";
import type { Report } from "../../types.ts";
import { bonInvestigationLoading } from "../../utils/investigation_loading.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonTopReasonsList } from "../../utils/top_reasons_list.ts";
import { bonPanelBuildPersonaStrip } from "./persona_strip.ts";

export interface BuildPreviewOpts {
  expectedDurationMs?: number | null;
}

export function bonPanelBuildPreview(
  _username: string,
  report: Report | null | undefined,
  { expectedDurationMs = null }: BuildPreviewOpts = {}
): HTMLDivElement | null {
  const investigation = bonNormalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );
  const hasFactors = (investigation?.factors.length ?? 0) > 0;

  if (investigation?.status === "queued") {
    const preview = document.createElement("div");
    preview.className = "bon-profile-panel__preview";
    const message = document.createElement("p");
    message.className = "bon-profile-panel__summary";
    message.textContent = "Queued — waiting for an open investigation slot.";
    preview.appendChild(message);
    return preview;
  }

  if (
    investigation?.status === "running" &&
    !bonIsInvestigationStale(investigation)
  ) {
    const preview = document.createElement("div");
    preview.className = "bon-profile-panel__preview";
    preview.appendChild(
      bonInvestigationLoading(investigation.startedAt, {
        compact: true,
        expectedDurationMs,
      })
    );

    return preview;
  }

  if (!investigation?.summary && !hasFactors) {
    return null;
  }

  const preview = document.createElement("div");
  preview.className = "bon-profile-panel__preview";

  const personaBlock = investigation?.persona?.label
    ? bonPanelBuildPersonaStrip(investigation.persona, {
        summary: investigation.summary,
      })
    : null;

  const reasonsList =
    investigation && hasFactors
      ? bonTopReasonsList(investigation.factors)
      : null;

  if (personaBlock && reasonsList) {
    const row = document.createElement("div");
    row.className = "bon-profile-panel__preview-row";
    row.appendChild(personaBlock);
    row.appendChild(reasonsList);
    preview.appendChild(row);
    return preview;
  }

  if (personaBlock) {
    preview.appendChild(personaBlock);
    return preview;
  }

  if (investigation?.summary) {
    const summary = document.createElement("p");
    summary.className = "bon-profile-panel__summary";
    summary.appendChild(bonLinkifyReddit(investigation.summary));
    preview.appendChild(summary);
  }

  if (reasonsList) {
    preview.appendChild(reasonsList);
  }

  return preview;
}
