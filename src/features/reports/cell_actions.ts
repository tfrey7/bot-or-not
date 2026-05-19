// Investigate button (🤖 / 🔁 / progress-ring) shown in the actions column,
// plus the "Delete report" danger button shown in the row's expanded footer.
// The investigate button's running state participates in the poll-tick's
// in-place updates (via data-bon-running-btn attributes) so the spinner /
// progress ring don't jitter on every render.

import type { Investigation } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsFormatRunningTitle } from "./logic.ts";
import { bonReportsOpenConfirmModal } from "./modals.ts";

export function bonReportsApplyProgressVisual(
  button: HTMLButtonElement,
  elapsedMs: number,
  expectedMs: number | null | undefined
): void {
  if (!expectedMs) {
    return;
  }

  const percent = Math.min(100, (elapsedMs / expectedMs) * 100);
  button.style.setProperty("--bon-progress", `${percent.toFixed(1)}%`);
  button.classList.toggle("bon-progress--overtime", elapsedMs > expectedMs);
}

export interface InvestigateButtonOpts {
  expectedDurationMs: number | null;
  onNoApiKey?: () => void;
}

export function bonReportsRenderInvestigateButton(
  username: string,
  investigation: Investigation | null | undefined,
  { expectedDurationMs, onNoApiKey }: InvestigateButtonOpts
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-investigate-btn";

  const running = investigation?.status === "running";
  const stale = running && bonIsInvestigationStale(investigation);
  const verdict = investigation?.verdict;

  if (running && !stale && investigation) {
    button.textContent = "";
    button.disabled = true;
    button.dataset.bonRunningBtn = username;

    const startedAt = investigation.startedAt || Date.now();
    button.dataset.bonRunningStartedAt = String(startedAt);

    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const elapsedSec = Math.round(elapsedMs / 1000);

    if (expectedDurationMs) {
      button.classList.add("bon-progress");
      bonReportsApplyProgressVisual(button, elapsedMs, expectedDurationMs);
    } else {
      button.classList.add("bon-spinning");
    }

    button.title = bonReportsFormatRunningTitle(elapsedSec, expectedDurationMs);
  } else if (stale) {
    button.textContent = "🔁";
    button.title = "Retry stalled investigation";
  } else if (verdict) {
    button.textContent = "🔁";
    button.title = "Re-run AI investigation";
  } else {
    button.textContent = "🤖";
    button.title = "Run AI investigation";
  }

  button.setAttribute("aria-label", button.title);

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.classList.add("bon-spinning");
    button.textContent = "";
    try {
      const response = (await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      })) as { ok?: boolean; error?: string };
      if (response?.ok === false && response.error === "no-api-key") {
        onNoApiKey?.();
      }
      // storage.onChanged will reload and re-render.
    } catch (error) {
      console.error("[Bot or Not] investigate failed", error);
      button.disabled = false;
      button.classList.remove("bon-spinning");
      button.textContent = verdict ? "🔁" : "🤖";
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
