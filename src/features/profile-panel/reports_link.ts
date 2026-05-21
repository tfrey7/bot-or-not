// Header chip that opens the Reports page with this user pre-selected
// (reports/index.ts reads ?user= from the URL on load). Firefox blocks web
// pages from navigating to moz-extension:// URLs directly — so this is a
// <button> that asks the background to focus-or-open the tab, not a native
// <a href>.

import { bonClientSend } from "../../client.ts";

export function bonPanelBuildReportsLink(username: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-panel-btn";
  button.textContent = "↗️";
  button.title = `Open u/${username}'s dossier in the Reports page`;
  button.setAttribute("aria-label", button.title);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void bonClientSend({
      type: "open-reports-tab",
      username,
    });
  });

  return button;
}
