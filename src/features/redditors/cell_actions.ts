// Investigate + Delete buttons shown in the detail-pane footer. The
// investigate button's running state participates in the poll-tick's
// in-place text updates via data-bon-running-btn.

import { clientSend } from "../../client.ts";
import type { Investigation } from "../../types.ts";
import { investigationResults } from "../../utils/history.ts";
import { isInvestigationStale } from "../../verdict.ts";
import {
  redditorsFormatRunningCellText,
  redditorsFormatRunningTitle,
} from "./logic.ts";
import { pageOpenConfirmModal } from "../page";

export interface InvestigateButtonOpts {
  expectedDurationMs: number | null;
  queueAhead: number;

  // Combined count of dossier items (Google + passive) captured strictly
  // after the last investigation run. Surfaces in the idle button label
  // as "Re-Investigate · N new" so the operator sees, without scrolling
  // to the dossier sections, that fresh evidence is waiting to be
  // incorporated. Re-running stays a manual choice — investigations cost
  // money.
  freshHarvestCount?: number;

  onNoApiKey?: () => void;
  onInvestigate?: () => void;
}

function idleLabel(
  verdict: string | null | undefined,
  freshHarvestCount: number
): string {
  const base = verdict ? "Re-run" : "Investigate";
  if (freshHarvestCount > 0) {
    return `${base} · ${freshHarvestCount} new`;
  }

  return base;
}

function queuedLabel(ahead: number): string {
  if (ahead === 0) {
    return "Queued · next up";
  }

  return `Queued · ${ahead} ahead`;
}

export function redditorsRenderInvestigateButton(
  username: string,
  investigation: Investigation | null | undefined,
  {
    expectedDurationMs,
    queueAhead,
    freshHarvestCount = 0,
    onNoApiKey,
    onInvestigate,
  }: InvestigateButtonOpts
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-btn";

  const queued = investigation?.status === "queued";
  const running = investigation?.status === "running";
  const stale = running && isInvestigationStale(investigation);
  const verdict = investigationResults(investigation)?.verdict ?? null;

  if (freshHarvestCount > 0 && !queued && !running) {
    button.classList.add("bon-btn--fresh-harvest");
  }

  if (queued) {
    button.disabled = true;
    button.dataset.bonQueuedBtn = username;
    button.textContent = queuedLabel(queueAhead);
    button.title =
      queueAhead === 0
        ? "Up next — will start when a slot frees"
        : `Waiting behind ${queueAhead} other investigation${queueAhead === 1 ? "" : "s"}`;
  } else if (running && !stale && investigation) {
    button.disabled = true;
    button.dataset.bonRunningBtn = username;

    const startedAt = investigation.startedAt || Date.now();
    button.dataset.bonRunningStartedAt = String(startedAt);

    const elapsedSec = Math.round(Math.max(0, Date.now() - startedAt) / 1000);
    button.textContent = redditorsFormatRunningCellText(
      elapsedSec,
      expectedDurationMs
    );
    button.title = redditorsFormatRunningTitle(elapsedSec, expectedDurationMs);
  } else if (stale) {
    button.textContent = "Retry stalled";
    button.title = "Retry stalled investigation";
  } else {
    button.textContent = idleLabel(verdict, freshHarvestCount);
    button.title =
      freshHarvestCount > 0
        ? `${freshHarvestCount} item${freshHarvestCount === 1 ? "" : "s"} captured since last analysis — re-investigate to incorporate.`
        : button.textContent;
  }

  button.setAttribute("aria-label", button.title);

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Starting…";
    onInvestigate?.();
    try {
      const response = await clientSend<{ ok?: boolean; error?: string }>({
        type: "investigate-user",
        username,
      });

      if (response?.ok === false && response.error === "no-api-key") {
        onNoApiKey?.();
      }
    } catch (error) {
      console.error("[Bot or Not] investigate failed", error);
      button.disabled = false;
      button.textContent = idleLabel(verdict, freshHarvestCount);
    }
  });

  return button;
}

export function redditorsRenderDeleteButton(
  username: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-btn bon-btn--danger";
  button.textContent = "Delete";
  button.title = `Delete report for u/${username}`;

  button.addEventListener("click", () => {
    pageOpenConfirmModal({
      text: `Delete the report for u/${username}? This can't be undone.`,
      confirmLabel: "Delete",
      action: () => clientSend({ type: "delete-report", username }),
    });
  });

  return button;
}
