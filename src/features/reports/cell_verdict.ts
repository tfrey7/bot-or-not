// AI verdict badge in the table's "AI verdict" column. Surfaces both
// running and error states so the column doesn't read as "—" when an
// investigation is mid-flight or failed.

import type { Investigation } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";

export function bonReportsVerdictBadge(
  rawInvestigation: Investigation | null | undefined
): HTMLSpanElement | null {
  if (!rawInvestigation) {
    return null;
  }

  if (rawInvestigation.status === "running") {
    const stale = bonIsInvestigationStale(rawInvestigation);

    const span = document.createElement("span");
    span.className = `bon-verdict-badge bon-verdict-badge--${stale ? "error" : "running"}`;
    span.textContent = stale ? "Stalled" : "Running";
    span.title = stale
      ? "Investigation appears orphaned — click the retry button to re-run"
      : "Investigation in progress";

    return span;
  }

  if (rawInvestigation.status === "error") {
    const span = document.createElement("span");
    span.className = "bon-verdict-badge bon-verdict-badge--error";
    span.textContent = "Error";
    span.title = rawInvestigation.error ?? "Investigation failed";
    return span;
  }

  const investigation = bonNormalizeInvestigation(rawInvestigation);

  if (!investigation.verdict) {
    return null;
  }

  const span = document.createElement("span");
  span.className = `bon-verdict-badge bon-verdict-badge--${investigation.verdict}`;
  span.textContent = bonFormatVerdict(investigation.verdict);
  span.title = investigation.summary || investigation.verdict;

  return span;
}
