// Full investigation detail rendered in the expanded row — orchestrates
// the summary, full non-neutral factor bullet list, persona aside, and
// run metadata.

import type { Investigation } from "../../types.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonTopReasonsList } from "../../utils/top_reasons_list.ts";
import { bonInvestigationLoading } from "../../utils/investigation_loading.ts";
import { bonReportsPersonaBlock } from "./persona_block.ts";

export interface InvestigationDetailOpts {
  expectedDurationMs?: number | null;
}

export function bonReportsInvestigationDetail(
  rawInvestigation: Investigation | null | undefined,
  inRing = false,
  { expectedDurationMs = null }: InvestigationDetailOpts = {}
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  if (!rawInvestigation) {
    const empty = document.createElement("p");
    empty.className = "bon-verdict-meta";
    empty.textContent = "Not yet investigated.";
    wrap.appendChild(empty);
    return wrap;
  }

  const investigation = bonNormalizeInvestigation(rawInvestigation, inRing);

  if (investigation.status === "queued") {
    const message = document.createElement("p");
    message.className = "bon-verdict-meta";
    message.textContent =
      "Queued — will start when an active investigation slot frees up.";
    wrap.appendChild(message);
    return wrap;
  }

  if (investigation.status === "running") {
    const stale = bonIsInvestigationStale(investigation);

    if (stale) {
      const message = document.createElement("p");
      message.className = "bon-verdict-meta";
      message.textContent = investigation.startedAt
        ? `Stalled — started ${new Date(investigation.startedAt).toLocaleString()}, never completed. Click the retry button above to re-run.`
        : "Stalled — never completed. Click the retry button above to re-run.";
      wrap.appendChild(message);
      return wrap;
    }

    wrap.appendChild(
      bonInvestigationLoading(investigation.startedAt, { expectedDurationMs })
    );

    return wrap;
  }

  if (investigation.status === "error") {
    const errorBlock = document.createElement("div");
    errorBlock.className = "bon-verdict-error";
    errorBlock.textContent = `Investigation failed: ${investigation.error ?? "unknown error"}`;
    wrap.appendChild(errorBlock);
    return wrap;
  }

  const reasonsList =
    investigation.factors.length > 0
      ? bonTopReasonsList(investigation.factors, 4)
      : null;

  const personaBlock = bonReportsPersonaBlock(investigation.persona, {
    summary: investigation.summary,
  });

  if (personaBlock && reasonsList) {
    const row = document.createElement("div");
    row.className = "bon-summary-row";
    row.appendChild(personaBlock);

    const reasonsCol = document.createElement("div");
    reasonsCol.className = "bon-summary-col";
    reasonsCol.appendChild(reasonsList);
    row.appendChild(reasonsCol);

    wrap.appendChild(row);
    return wrap;
  }

  if (personaBlock) {
    // Summary already lives inside personaBlock when one is present.
    wrap.appendChild(personaBlock);
    return wrap;
  }

  if (investigation.summary) {
    const summary = document.createElement("p");
    summary.className = "bon-verdict-summary";
    summary.appendChild(bonLinkifyReddit(investigation.summary));
    wrap.appendChild(summary);
  }

  if (reasonsList) {
    wrap.appendChild(reasonsList);
  }

  return wrap;
}
