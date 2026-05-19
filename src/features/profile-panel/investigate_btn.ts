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

  if (running && !stale) {
    button.textContent = "⏳ Investigating…";
    button.disabled = true;
    button.classList.add("bon-spinning");
  } else if (stale) {
    button.textContent = "🔁 Retry (stalled)";
  } else if (verdict) {
    button.textContent = "🔁 Re-investigate";
  } else {
    button.textContent = "🤖 Investigate";
  }

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.classList.add("bon-spinning");
    button.textContent = "⏳ Investigating…";

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
        button.textContent = verdict ? "🔁 Re-investigate" : "🤖 Investigate";
      }
      // storage.onChanged will trigger refreshProfilePanel.
    } catch (error) {
      console.error("[Bot or Not] investigate failed", error);
      button.disabled = false;
      button.classList.remove("bon-spinning");
      button.textContent = verdict ? "🔁 Re-investigate" : "🤖 Investigate";
    }
  });

  return button;
}
