// The always-visible preview block between the panel header and the
// collapsible body. Mirrors the reports detail pane: persona card (label
// + radar + summary) on the LEFT, HUMAN/BOT signals list on the RIGHT.
// Returns null when there's no investigation to preview so the panel can
// fall back to a single bare toggle row.

import { isInvestigationStale, normalizeInvestigation } from "../../verdict.ts";
import type { Report } from "../../types.ts";
import { investigationLoading } from "../../utils/investigation_loading.ts";
import {
  linkifyPanelOptions,
  linkifyReddit,
} from "../../utils/linkify_reddit.ts";
import { topReasonsList } from "../../utils/top_reasons_list.ts";
import { panelBuildPersonaStrip } from "./persona_strip.ts";

export interface BuildPreviewOpts {
  expectedDurationMs?: number | null;
}

export function panelBuildPreview(
  _username: string,
  report: Report | null | undefined,
  { expectedDurationMs = null }: BuildPreviewOpts = {}
): HTMLDivElement | null {
  const investigation = normalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );

  if (investigation?.status === "queued") {
    const preview = document.createElement("div");
    preview.className = "bon-profile-panel__preview";
    const message = document.createElement("p");
    message.className = "bon-profile-panel__summary";
    const remainingMs = investigation.notBefore
      ? investigation.notBefore - Date.now()
      : 0;

    if (remainingMs > 0) {
      const secs = Math.max(1, Math.ceil(remainingMs / 1000));
      message.textContent = `Paused — upstream rate-limited the last attempt. Retrying in ${secs}s.`;
    } else {
      message.textContent = "Queued — waiting for an open investigation slot.";
    }

    preview.appendChild(message);
    return preview;
  }

  if (
    investigation?.status === "running" &&
    !isInvestigationStale(investigation)
  ) {
    const preview = document.createElement("div");
    preview.className = "bon-profile-panel__preview";
    preview.appendChild(
      investigationLoading(investigation.startedAt, {
        compact: true,
        expectedDurationMs,
      })
    );

    return preview;
  }

  if (investigation?.status !== "done") {
    return null;
  }

  const { summary, persona, factors } = investigation.results;
  const hasFactors = factors.length > 0;

  if (!summary && !hasFactors) {
    return null;
  }

  const preview = document.createElement("div");
  preview.className = "bon-profile-panel__preview";

  const personaBlock = persona?.label
    ? panelBuildPersonaStrip(persona, { summary })
    : null;

  const reasonsList = hasFactors
    ? topReasonsList(factors, { linkify: linkifyPanelOptions() })
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

  if (summary) {
    const summaryEl = document.createElement("p");
    summaryEl.className = "bon-profile-panel__summary";
    summaryEl.appendChild(linkifyReddit(summary, linkifyPanelOptions()));
    preview.appendChild(summaryEl);
  }

  if (reasonsList) {
    preview.appendChild(reasonsList);
  }

  return preview;
}
