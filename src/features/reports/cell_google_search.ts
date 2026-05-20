// "Google" action button in the detail-pane actions row. Opens a Google
// search for the user (scoped to reddit.com) in a new tab. The
// google-harvest content script activates on any SERP whose query matches
// the canonical "<username> site:reddit.com" pattern — so this button is
// just a launcher; pagination + repeat searches all get picked up too.

export function bonReportsRenderGoogleSearchButton(
  username: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-btn";
  button.textContent = "Google";
  button.title = `Open Google search for u/${username} (site:reddit.com)`;

  button.addEventListener("click", () => {
    // Quote the username so Google treats it as an exact phrase — without it,
    // word-like handles ("candy", "willy") drown in unrelated reddit.com hits.
    const query = encodeURIComponent(`"${username}" site:reddit.com`);
    const url = `https://www.google.com/search?q=${query}`;
    window.open(url, "_blank", "noopener");
  });

  return button;
}
