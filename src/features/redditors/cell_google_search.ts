// "Google" action button in the detail-pane actions row. Opens a Google
// search for the user (scoped to reddit.com) in a new tab. If the operator
// has opted into the optional google.com permission, the google-harvest
// content script then activates on the SERP and merges any Reddit hits
// into the user's dossier — pagination + repeat searches all flow in too.
// Without that permission, the button is just a launcher.

export function redditorsRenderGoogleSearchButton(
  username: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-btn";
  button.textContent = "Google";
  button.title =
    `Open Google search for u/${username} (site:reddit.com). ` +
    `Capture into the dossier requires enabling Google dossier in Settings.`;

  button.addEventListener("click", () => {
    // Quote the username so Google treats it as an exact phrase — without it,
    // word-like handles ("candy", "willy") drown in unrelated reddit.com hits.
    const query = encodeURIComponent(`"${username}" site:reddit.com`);
    const url = `https://www.google.com/search?q=${query}`;
    window.open(url, "_blank", "noopener");
  });

  return button;
}
