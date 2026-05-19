// The small verdict stat pill that lives in the panel header (next to the
// "Bot or Not" title), summarising the current investigation state with
// one glanceable chip.

import type { Investigation, Report } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";

function buildVerdictPill(
  investigation: Investigation | null | undefined
): HTMLSpanElement | null {
  if (!investigation) {
    return null;
  }

  const span = document.createElement("span");

  if (investigation.status === "running") {
    const stale = bonIsInvestigationStale(investigation);

    span.className = `bon-stat-pill bon-stat-pill--verdict-${stale ? "error" : "running"}`;
    span.textContent = stale ? "🤖 Stalled" : "🤖 Investigating…";
    span.title = stale
      ? "AI investigation appears orphaned — click investigate to retry"
      : "AI investigation in progress";
    return span;
  }

  if (investigation.status === "error") {
    span.className = "bon-stat-pill bon-stat-pill--verdict-error";
    span.textContent = "🤖 Error";
    span.title = investigation.error ?? "Investigation failed";
    return span;
  }

  const normalized = bonNormalizeInvestigation(investigation);
  if (!normalized.verdict) {
    return null;
  }

  span.className = `bon-stat-pill bon-stat-pill--verdict-${normalized.verdict}`;
  span.textContent = `🤖 ${bonFormatVerdict(normalized.verdict)}`;
  span.title = normalized.summary || normalized.verdict;
  return span;
}

export function bonPanelAppendStatPills(
  container: HTMLElement,
  report: Report | null | undefined
): void {
  const verdictPill = buildVerdictPill(report?.investigation);

  if (verdictPill) {
    container.appendChild(verdictPill);
  }
}
