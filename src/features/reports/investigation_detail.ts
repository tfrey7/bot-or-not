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
import {
  bonReportsIsUserNotFoundError,
  bonReportsUserNotFoundPanel,
} from "./investigation_user_not_found.ts";

export interface InvestigationDetailOpts {
  expectedDurationMs?: number | null;
  username?: string;
}

export function bonReportsInvestigationDetail(
  rawInvestigation: Investigation | null | undefined,
  inRing = false,
  { expectedDurationMs = null, username }: InvestigationDetailOpts = {}
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
    wrap.appendChild(buildQueuedPanel(investigation.notBefore ?? null));
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
    if (username && bonReportsIsUserNotFoundError(investigation.error)) {
      wrap.appendChild(bonReportsUserNotFoundPanel(username));
      return wrap;
    }

    const errorBlock = document.createElement("div");
    errorBlock.className = "bon-verdict-error";
    errorBlock.textContent = `Investigation failed: ${investigation.error ?? "unknown error"}`;
    wrap.appendChild(errorBlock);
    return wrap;
  }

  const { factors, persona, summary } = investigation.results;
  const reasonsList =
    factors.length > 0 ? bonTopReasonsList(factors, { perSide: 4 }) : null;

  const personaBlock = bonReportsPersonaBlock(persona, { summary });

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

  if (summary) {
    const summaryEl = document.createElement("p");
    summaryEl.className = "bon-verdict-summary";
    summaryEl.appendChild(bonLinkifyReddit(summary));
    wrap.appendChild(summaryEl);
  }

  if (reasonsList) {
    wrap.appendChild(reasonsList);
  }

  return wrap;
}

function buildQueuedPanel(notBefore: number | null): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "bon-queued-panel";

  const figure = document.createElement("img");
  figure.className = "bon-queued-panel__art";
  figure.src = browser.runtime.getURL("icons/chromes-pocket-watch.png");
  figure.alt =
    "Sherlock Chromes leaning against a foggy gas-lamp lamppost, checking a brass pocket watch";
  panel.appendChild(figure);

  const message = document.createElement("p");
  message.className = "bon-queued-panel__body";
  const remainingMs = notBefore ? notBefore - Date.now() : 0;
  if (remainingMs > 0) {
    const secs = Math.max(1, Math.ceil(remainingMs / 1000));
    message.textContent = `Paused — the upstream rate-limited the last attempt. Retrying in ${secs}s.`;
  } else {
    message.textContent =
      "Queued — will start when an active investigation slot frees up.";
  }

  panel.appendChild(message);

  return panel;
}
