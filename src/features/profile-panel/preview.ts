// The always-visible preview block between the panel header and the
// collapsible body: investigation summary + top-reasons list + factor-dots
// strip on the left, persona radar card on the right. Returns null when
// there's no investigation to preview so the panel can fall back to a
// single bare toggle row.

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

  const summaryCol = document.createElement("div");
  summaryCol.className = "bon-profile-panel__preview-summary";

  if (investigation?.summary) {
    const summary = document.createElement("p");
    summary.className = "bon-profile-panel__summary";
    summary.appendChild(bonLinkifyReddit(investigation.summary));
    summaryCol.appendChild(summary);
  }

  if (investigation && hasFactors) {
    const reasons = bonTopReasonsList(investigation.factors);
    if (reasons) {
      summaryCol.appendChild(reasons);
    }
  }

  const personaBlock = investigation?.persona?.label
    ? bonPanelBuildPersonaStrip(investigation.persona)
    : null;

  if (personaBlock && summaryCol.childNodes.length) {
    const row = document.createElement("div");
    row.className = "bon-profile-panel__preview-row";
    row.appendChild(summaryCol);
    row.appendChild(personaBlock);
    preview.appendChild(row);
  } else {
    if (summaryCol.childNodes.length) {
      preview.appendChild(summaryCol);
    }

    if (personaBlock) {
      preview.appendChild(personaBlock);
    }
  }

  return preview;
}
