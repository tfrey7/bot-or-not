// The "🤖 Investigate" / "🔁 Re-investigate" / "⏳ Investigating…" button
// in the panel header. Sends investigate-user to the background and lets
// storage.onChanged drive the re-render; only handles its own transient
// disabled state and the no-api-key alert.

import type { Investigation } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";

export function bonPanelBuildInvestigateBtn(
  username: string,
  investigation: Investigation | null | undefined
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-panel-btn";

  const running = investigation?.status === "running";
  const stale = running && bonIsInvestigationStale(investigation);
  const verdict = investigation?.verdict;

  const setState = (
    kind: "investigating" | "retry" | "reinvestigate" | "investigate"
  ): void => {
    if (kind === "investigating") {
      button.textContent = "⏳";
      button.title = "Investigating…";
    } else if (kind === "retry") {
      button.textContent = "🔁";
      button.title = "Retry (stalled)";
    } else if (kind === "reinvestigate") {
      button.textContent = "🔁";
      button.title = "Re-investigate";
    } else {
      button.textContent = "🤖";
      button.title = "Investigate";
    }
    button.setAttribute("aria-label", button.title);
  };

  if (running && !stale) {
    setState("investigating");
    button.disabled = true;
    button.classList.add("bon-spinning");
  } else if (stale) {
    setState("retry");
  } else if (verdict) {
    setState("reinvestigate");
  } else {
    setState("investigate");
  }

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.classList.add("bon-spinning");
    setState("investigating");

    try {
      const response = (await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      })) as { ok?: boolean; error?: string };

      if (response?.ok === false && response.error === "no-api-key") {
        alert(
          "No Claude API key set. Click the Bot or Not toolbar icon, then open Settings to add one."
        );
        button.disabled = false;
        button.classList.remove("bon-spinning");
        setState(verdict ? "reinvestigate" : "investigate");
      }
      // storage.onChanged will trigger refreshProfilePanel.
    } catch (error) {
      console.error("[Bot or Not] investigate failed", error);
      button.disabled = false;
      button.classList.remove("bon-spinning");
      setState(verdict ? "reinvestigate" : "investigate");
    }
  });

  return button;
}
