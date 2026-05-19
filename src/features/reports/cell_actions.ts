// Investigate + Delete buttons shown in the detail-pane footer. The
// investigate button's running state participates in the poll-tick's
// in-place text updates via data-bon-running-btn.

import type { Investigation } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import {
  bonReportsFormatRunningCellText,
  bonReportsFormatRunningTitle,
} from "./logic.ts";
import { bonReportsOpenConfirmModal } from "./modals.ts";

export interface InvestigateButtonOpts {
  expectedDurationMs: number | null;
  onNoApiKey?: () => void;
}

function idleLabel(verdict: string | null | undefined): string {
  return verdict ? "Re-run AI investigation" : "Run AI investigation";
}

export function bonReportsRenderInvestigateButton(
  username: string,
  investigation: Investigation | null | undefined,
  { expectedDurationMs, onNoApiKey }: InvestigateButtonOpts
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-btn";

  const running = investigation?.status === "running";
  const stale = running && bonIsInvestigationStale(investigation);
  const verdict = investigation?.verdict;

  if (running && !stale && investigation) {
    button.disabled = true;
    button.dataset.bonRunningBtn = username;

    const startedAt = investigation.startedAt || Date.now();
    button.dataset.bonRunningStartedAt = String(startedAt);

    const elapsedSec = Math.round(Math.max(0, Date.now() - startedAt) / 1000);
    button.textContent = bonReportsFormatRunningCellText(
      elapsedSec,
      expectedDurationMs
    );
    button.title = bonReportsFormatRunningTitle(elapsedSec, expectedDurationMs);
  } else if (stale) {
    button.textContent = "Retry stalled investigation";
    button.title = "Retry stalled investigation";
  } else {
    button.textContent = idleLabel(verdict);
    button.title = button.textContent;
  }

  button.setAttribute("aria-label", button.title);

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Starting…";
    try {
      const response = (await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      })) as { ok?: boolean; error?: string };
      if (response?.ok === false && response.error === "no-api-key") {
        onNoApiKey?.();
      }
    } catch (error) {
      console.error("[Bot or Not] investigate failed", error);
      button.disabled = false;
      button.textContent = idleLabel(verdict);
    }
  });

  return button;
}

export function bonReportsRenderDeleteButton(
  username: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-btn bon-btn--danger";
  button.textContent = `Delete report for u/${username}`;

  button.addEventListener("click", () => {
    bonReportsOpenConfirmModal({
      text: `Delete the report for u/${username}? This can't be undone.`,
      confirmLabel: "Delete",
      action: () =>
        browser.runtime.sendMessage({ type: "delete-report", username }),
    });
  });

  return button;
}
