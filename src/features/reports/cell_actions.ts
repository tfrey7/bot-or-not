// Action buttons in the last column: 🤖 investigate / 🔁 re-investigate /
// progress-ring while running, plus 🗑 delete. The investigate button's
// running state participates in the poll-tick's in-place updates (via
// data-bon-running-btn attributes) so the spinner / progress ring don't
// jitter on every render.

import type { Investigation } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsFormatRunningTitle } from "./logic.ts";
import { bonReportsOpenConfirmModal } from "./modals.ts";

export function bonReportsApplyProgressVisual(
  btn: HTMLButtonElement,
  elapsedMs: number,
  expectedMs: number | null | undefined
): void {
  if (!expectedMs) {
    return;
  }
  const pct = Math.min(100, (elapsedMs / expectedMs) * 100);
  btn.style.setProperty("--bon-progress", `${pct.toFixed(1)}%`);
  btn.classList.toggle("bon-progress--overtime", elapsedMs > expectedMs);
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
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bon-investigate-btn";
  const running = investigation?.status === "running";
  const stale = running && bonIsInvestigationStale(investigation);
  const verdict = investigation?.verdict;
  if (running && !stale && investigation) {
    btn.textContent = "";
    btn.disabled = true;
    btn.dataset.bonRunningBtn = username;
    const startedAt = investigation.startedAt || Date.now();
    btn.dataset.bonRunningStartedAt = String(startedAt);
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const elapsedSec = Math.round(elapsedMs / 1000);
    if (expectedDurationMs) {
      btn.classList.add("bon-progress");
      bonReportsApplyProgressVisual(btn, elapsedMs, expectedDurationMs);
    } else {
      btn.classList.add("bon-spinning");
    }
    btn.title = bonReportsFormatRunningTitle(elapsedSec, expectedDurationMs);
  } else if (stale) {
    btn.textContent = "🔁";
    btn.title = "Retry stalled investigation";
  } else if (verdict) {
    btn.textContent = "🔁";
    btn.title = "Re-run AI investigation";
  } else {
    btn.textContent = "🤖";
    btn.title = "Run AI investigation";
  }
  btn.setAttribute("aria-label", btn.title);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.classList.add("bon-spinning");
    btn.textContent = "";
    try {
      const res = (await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      })) as { ok?: boolean; error?: string };
      if (res?.ok === false && res.error === "no-api-key") {
        onNoApiKey?.();
      }
      // storage.onChanged will reload and re-render.
    } catch (err) {
      console.error("[Bot or Not] investigate failed", err);
      btn.disabled = false;
      btn.classList.remove("bon-spinning");
      btn.textContent = verdict ? "🔁" : "🤖";
    }
  });
  return btn;
}

export function bonReportsRenderDeleteButton(
  username: string
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bon-investigate-btn bon-delete-btn";
  btn.textContent = "🗑";
  btn.title = `Delete report for u/${username}`;
  btn.setAttribute("aria-label", btn.title);
  btn.addEventListener("click", () => {
    bonReportsOpenConfirmModal({
      text: `Delete the report for u/${username}? This can't be undone.`,
      confirmLabel: "Delete",
      action: () =>
        browser.runtime.sendMessage({ type: "delete-report", username }),
    });
  });
  return btn;
}
