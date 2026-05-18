// Full investigation detail rendered in the expanded row — orchestrates
// the summary + top reasons, persona aside, run metadata line, and the
// per-factor card list.

import { bonFmtDuration } from "../../utils/format_time.js";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.js";
import { bonReportsFactorsList } from "./investigation_factors.js";
import { bonReportsPersonaBlock } from "./persona_block.js";
import { bonReportsTopReasonsList } from "./top_reasons.js";

export function bonReportsInvestigationDetail(rawInvestigation) {
  const investigation = bonNormalizeInvestigation(rawInvestigation);
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "AI investigation";
  wrap.appendChild(title);

  if (investigation.status === "running") {
    const stale = bonIsInvestigationStale(investigation);
    const p = document.createElement("p");
    p.className = "bon-verdict-meta";
    if (stale) {
      p.textContent = investigation.startedAt
        ? `Stalled — started ${new Date(investigation.startedAt).toLocaleString()}, never completed. Click the retry button above to re-run.`
        : "Stalled — never completed. Click the retry button above to re-run.";
    } else {
      p.textContent = investigation.startedAt
        ? `Running since ${new Date(investigation.startedAt).toLocaleString()}…`
        : "Running…";
    }
    wrap.appendChild(p);
    return wrap;
  }

  if (investigation.status === "error") {
    const err = document.createElement("div");
    err.className = "bon-verdict-error";
    err.textContent = `Investigation failed: ${investigation.error || "unknown error"}`;
    wrap.appendChild(err);
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

  if (Array.isArray(investigation.factors) && investigation.factors.length) {
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
  const metaParts = [];
  if (typeof investigation.confidence === "number") {
    metaParts.push(
      `overall confidence ${Math.round(investigation.confidence * 100)}%`
    );
  }
  if (investigation.model) {
    metaParts.push(investigation.model);
  }
  if (investigation.runAt) {
    const ts = new Date(investigation.runAt).toLocaleString();
    metaParts.push(`run ${ts}`);
  }
  if (typeof investigation.durationMs === "number") {
    metaParts.push(`took ${bonFmtDuration(investigation.durationMs)}`);
  }
  if (typeof investigation.postsFetched === "number") {
    metaParts.push(
      `${investigation.postsFetched} posts, ${investigation.commentsFetched ?? 0} comments analyzed`
    );
  }
  if (typeof investigation.webSearchCount === "number") {
    metaParts.push(
      investigation.webSearchCount > 0
        ? `🌐 web search: ${investigation.webSearchCount}`
        : "🌐 web search: skipped"
    );
  }
  meta.textContent = metaParts.join(" · ");
  wrap.appendChild(meta);

  if (Array.isArray(investigation.factors) && investigation.factors.length) {
    wrap.appendChild(bonReportsFactorsList(investigation.factors));
  }

  return wrap;
}
