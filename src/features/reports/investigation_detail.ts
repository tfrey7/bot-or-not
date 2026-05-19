// Full investigation detail rendered in the expanded row — orchestrates
// the summary + top reasons, persona aside, run metadata line, and the
// per-factor card list.

import type { Investigation } from "../../types.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonTopReasonsList } from "../../utils/top_reasons_list.ts";
import { bonReportsFactorsList } from "./investigation_factors.ts";
import { bonReportsInvestigationLoading } from "./investigation_loading.ts";
import { bonReportsPersonaBlock } from "./persona_block.ts";

export function bonReportsInvestigationDetail(
  rawInvestigation: Investigation | null | undefined,
  contextItemsCount: number = 0,
  actions: HTMLElement[] = [],
  inRing = false
): HTMLDivElement {
  const contextLabel = formatContextLabel(contextItemsCount);

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const header = document.createElement("div");
  header.className = "bon-detail-header";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "AI investigation";
  header.appendChild(title);

  if (actions.length > 0) {
    const actionsRow = document.createElement("div");
    actionsRow.className = "bon-detail-header-actions";
    for (const action of actions) {
      actionsRow.appendChild(action);
    }
    header.appendChild(actionsRow);
  }

  wrap.appendChild(header);

  if (!rawInvestigation) {
    const empty = document.createElement("p");
    empty.className = "bon-verdict-meta";
    empty.textContent = "Not yet investigated.";
    wrap.appendChild(empty);
    return wrap;
  }

  const investigation = bonNormalizeInvestigation(rawInvestigation, inRing);

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
      bonReportsInvestigationLoading(investigation.startedAt, contextLabel)
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

  const summaryCol = document.createElement("div");
  summaryCol.className = "bon-summary-col";

  if (investigation.summary) {
    const summary = document.createElement("p");
    summary.className = "bon-verdict-summary";
    summary.appendChild(bonLinkifyReddit(investigation.summary));
    summaryCol.appendChild(summary);
  }

  if (investigation.factors.length > 0) {
    const reasons = bonTopReasonsList(investigation.factors);
    if (reasons) {
      summaryCol.appendChild(reasons);
    }
  }

  const personaBlock = bonReportsPersonaBlock(investigation.persona);

  if (personaBlock && summaryCol.childNodes.length) {
    const row = document.createElement("div");
    row.className = "bon-summary-row";
    row.appendChild(summaryCol);
    row.appendChild(personaBlock);
    wrap.appendChild(row);
  } else {
    if (summaryCol.childNodes.length) {
      wrap.appendChild(summaryCol);
    }
    if (personaBlock) {
      wrap.appendChild(personaBlock);
    }
  }

  if (contextLabel) {
    const contextMeta = document.createElement("p");
    contextMeta.className = "bon-verdict-meta";
    contextMeta.textContent = `📎 ${contextLabel}`;
    wrap.appendChild(contextMeta);
  }

  if (investigation.factors.length > 0) {
    wrap.appendChild(bonReportsFactorsList(investigation.factors));
  }

  return wrap;
}

function formatContextLabel(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1
    ? "1 context item included"
    : `${count} context items included`;
}
