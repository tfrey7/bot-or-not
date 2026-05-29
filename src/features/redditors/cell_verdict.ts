// AI verdict badge in the table's "AI verdict" column. Surfaces both
// running and error states so the column doesn't read as "—" when an
// investigation is mid-flight or failed.

import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import type { Investigation } from "../../types.ts";
import { formatVerdict } from "../../utils/format_text.ts";
import { isInvestigationStale, normalizeInvestigation } from "../../verdict.ts";

export function redditorsVerdictBadge(
  rawInvestigation: Investigation | null | undefined,
  inRing = false,
  queueAhead = 0
): HTMLSpanElement | null {
  if (!rawInvestigation) {
    return null;
  }

  const isPriority =
    (rawInvestigation.status === "queued" ||
      rawInvestigation.status === "running") &&
    (rawInvestigation.priority ?? QUEUE_PRIORITY.bulk) > QUEUE_PRIORITY.bulk;

  if (rawInvestigation.status === "queued") {
    const pauseRemainingSec = queuedPauseRemainingSec(rawInvestigation);
    const span = document.createElement("span");

    if (pauseRemainingSec !== null) {
      span.className = "bon-verdict-badge bon-verdict-badge--paused";
      span.textContent = `Paused · ${pauseRemainingSec}s`;
      span.title = `Upstream rate-limited the last attempt — waiting ${pauseRemainingSec}s before retrying.`;
      return markPriority(span, isPriority);
    }

    span.className = "bon-verdict-badge bon-verdict-badge--queued";
    span.textContent =
      queueAhead === 0 ? "Queued · next" : `Queued · ${queueAhead} ahead`;
    span.title =
      queueAhead === 0
        ? "Up next — will start when a slot frees"
        : `Waiting behind ${queueAhead} other investigation${queueAhead === 1 ? "" : "s"}`;

    return markPriority(span, isPriority);
  }

  if (rawInvestigation.status === "running") {
    const stale = isInvestigationStale(rawInvestigation);

    const span = document.createElement("span");
    span.className = `bon-verdict-badge bon-verdict-badge--${stale ? "error" : "running"}`;
    span.textContent = stale ? "Stalled" : "Running";
    span.title = stale
      ? "Investigation appears orphaned — click the retry button to re-run"
      : "Investigation in progress";

    return markPriority(span, isPriority);
  }

  if (rawInvestigation.status === "error") {
    const span = document.createElement("span");
    span.className = "bon-verdict-badge bon-verdict-badge--error";
    span.textContent = "Error";
    span.title = rawInvestigation.error ?? "Investigation failed";
    return span;
  }

  const investigation = normalizeInvestigation(rawInvestigation, inRing);

  if (investigation.status !== "done") {
    return null;
  }

  const { verdict, summary } = investigation.results;
  const span = document.createElement("span");
  span.className = `bon-verdict-badge bon-verdict-badge--${verdict}`;
  span.textContent = formatVerdict(verdict);
  span.title = summary || verdict;

  return span;
}

// Stamp a queued/running badge as priority: a leading star + amber accent
// so a manually-launched / currently-viewed investigation reads as ahead of
// the bulk subreddit-sweep rows it's sorted above.
function markPriority(
  span: HTMLSpanElement,
  isPriority: boolean
): HTMLSpanElement {
  if (!isPriority) {
    return span;
  }

  span.classList.add("bon-verdict-badge--priority");
  span.title = `Priority — ${span.title}`;

  const star = document.createElement("span");
  star.className = "bon-verdict-badge-star";
  star.textContent = "★";
  star.setAttribute("aria-hidden", "true");
  span.prepend(star);

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
