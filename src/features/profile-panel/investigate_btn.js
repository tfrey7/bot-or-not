// The "🤖 Investigate" / "🔁 Re-investigate" / "⏳ Investigating…" button
// in the panel header. Sends investigate-user to the background and lets
// storage.onChanged drive the re-render; only handles its own transient
// disabled state and the no-api-key alert.

import { bonIsInvestigationStale } from "../../verdict.js";

export function bonPanelBuildInvestigateBtn(username, investigation) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bon-panel-btn";
  const running = investigation?.status === "running";
  const stale = running && bonIsInvestigationStale(investigation);
  const verdict = investigation?.verdict;

  if (running && !stale) {
    btn.textContent = "⏳ Investigating…";
    btn.disabled = true;
    btn.classList.add("bon-spinning");
  } else if (stale) {
    btn.textContent = "🔁 Retry (stalled)";
  } else if (verdict) {
    btn.textContent = "🔁 Re-investigate";
  } else {
    btn.textContent = "🤖 Investigate";
  }

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    btn.classList.add("bon-spinning");
    btn.textContent = "⏳ Investigating…";
    try {
      const res = await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      });
      if (res?.ok === false && res.error === "no-api-key") {
        alert(
          "No Claude API key set. Click the Bot or Not toolbar icon, then open Settings to add one."
        );
        btn.disabled = false;
        btn.classList.remove("bon-spinning");
        btn.textContent = verdict ? "🔁 Re-investigate" : "🤖 Investigate";
      }
      // storage.onChanged will trigger refreshProfilePanel.
    } catch (err) {
      console.error("[Bot or Not] investigate failed", err);
      btn.disabled = false;
      btn.classList.remove("bon-spinning");
      btn.textContent = verdict ? "🔁 Re-investigate" : "🤖 Investigate";
    }
  });
  return btn;
}
