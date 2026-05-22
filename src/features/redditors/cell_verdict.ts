// AI verdict badge in the table's "AI verdict" column. Surfaces both
// running and error states so the column doesn't read as "—" when an
// investigation is mid-flight or failed.

import type { Investigation } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";

export function bonRedditorsVerdictBadge(
  rawInvestigation: Investigation | null | undefined,
  inRing = false,
  queueAhead = 0
): HTMLSpanElement | null {
  if (!rawInvestigation) {
    return null;
  }

  if (rawInvestigation.status === "queued") {
    const pauseRemainingSec = queuedPauseRemainingSec(rawInvestigation);
    const span = document.createElement("span");

    if (pauseRemainingSec !== null) {
      span.className = "bon-verdict-badge bon-verdict-badge--paused";
      span.textContent = `Paused · ${pauseRemainingSec}s`;
      span.title = `Upstream rate-limited the last attempt — waiting ${pauseRemainingSec}s before retrying.`;
      return span;
    }

    span.className = "bon-verdict-badge bon-verdict-badge--queued";
    span.textContent =
      queueAhead === 0 ? "Queued · next" : `Queued · ${queueAhead} ahead`;
    span.title =
      queueAhead === 0
        ? "Up next — will start when a slot frees"
        : `Waiting behind ${queueAhead} other investigation${queueAhead === 1 ? "" : "s"}`;

    return span;
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

  const investigation = bonNormalizeInvestigation(rawInvestigation, inRing);

  if (investigation.status !== "done") {
    return null;
  }

  const { verdict, summary } = investigation.results;
  const span = document.createElement("span");
  span.className = `bon-verdict-badge bon-verdict-badge--${verdict}`;
  span.textContent = bonFormatVerdict(verdict);
  span.title = summary || verdict;

  return span;
}

function queuedPauseRemainingSec(investigation: Investigation): number | null {
  if (investigation.status !== "queued") {
    return null;
  }

  const notBefore = investigation.notBefore ?? null;
  if (notBefore === null) {
    return null;
  }

  const remainingMs = notBefore - Date.now();
  if (remainingMs <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(remainingMs / 1000));
}
