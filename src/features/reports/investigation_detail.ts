// Full investigation detail rendered in the expanded row — orchestrates
// the summary + top reasons, persona aside, run metadata line, and the
// per-factor card list.

import type { Investigation } from "../../types.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";
import { bonReportsFactorsList } from "./investigation_factors.ts";
import { bonReportsPersonaBlock } from "./persona_block.ts";
import { bonReportsTopReasonsList } from "./top_reasons.ts";

export function bonReportsInvestigationDetail(
  rawInvestigation: Investigation,
  contextItemsCount: number = 0
): HTMLDivElement {
  const investigation = bonNormalizeInvestigation(rawInvestigation);
  const contextLabel = formatContextLabel(contextItemsCount);

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "AI investigation";
  wrap.appendChild(title);

  if (investigation.status === "running") {
    const stale = bonIsInvestigationStale(investigation);

    const message = document.createElement("p");
    message.className = "bon-verdict-meta";

    if (stale) {
      message.textContent = investigation.startedAt
        ? `Stalled — started ${new Date(investigation.startedAt).toLocaleString()}, never completed. Click the retry button above to re-run.`
        : "Stalled — never completed. Click the retry button above to re-run.";
    } else {
      const base = investigation.startedAt
        ? `Running since ${new Date(investigation.startedAt).toLocaleString()}…`
        : "Running…";
      message.textContent = contextLabel ? `${base} · ${contextLabel}` : base;
    }

    wrap.appendChild(message);
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
    summary.textContent = investigation.summary;
    summaryCol.appendChild(summary);
  }

  if (investigation.factors.length > 0) {
    const reasons = bonReportsTopReasonsList(investigation.factors);
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

  const meta = document.createElement("p");
  meta.className = "bon-verdict-meta";

  const metaParts: string[] = [];
  if (investigation.confidence !== null) {
    metaParts.push(
      `overall confidence ${Math.round(investigation.confidence * 100)}%`
    );
  }
  if (investigation.model) {
    metaParts.push(investigation.model);
  }
  if (investigation.runAt !== null) {
    const runAt = new Date(investigation.runAt).toLocaleString();
    metaParts.push(`run ${runAt}`);
  }
  if (investigation.durationMs !== null) {
    metaParts.push(`took ${bonFmtDuration(investigation.durationMs)}`);
  }
  metaParts.push(
    `${investigation.postsFetched} posts, ${investigation.commentsFetched} comments analyzed`
  );
  if (contextLabel) {
    metaParts.push(`📎 ${contextLabel}`);
  }
  metaParts.push(
    investigation.webSearchCount > 0
      ? `🌐 web search: ${investigation.webSearchCount}`
      : "🌐 web search: skipped"
  );

  meta.textContent = metaParts.join(" · ");
  wrap.appendChild(meta);

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
