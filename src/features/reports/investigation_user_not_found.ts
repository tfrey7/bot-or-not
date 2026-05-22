// Rendered in place of the generic error block when the investigation
// failed because Reddit returned 404 on the about endpoint — i.e. the
// username doesn't exist. Sherlock Chromes with an empty dossier folder
// reads as "case file is empty" without piling on red error text.

export function bonReportsIsUserNotFoundError(
  error: string | null | undefined
): boolean {
  return (
    typeof error === "string" && error.startsWith("User not found on Reddit")
  );
}

export function bonReportsUserNotFoundPanel(username: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-user-not-found";

  const figure = document.createElement("img");
  figure.className = "bon-user-not-found__art";
  figure.src = browser.runtime.getURL("icons/chromes-empty-dossier.png");
  figure.alt =
    "Sherlock Chromes looking baffled at an empty dossier folder with only a question mark inside";
  wrap.appendChild(figure);

  const headline = document.createElement("p");
  headline.className = "bon-user-not-found__headline";
  headline.textContent = "Case file is empty";
  wrap.appendChild(headline);

  const body = document.createElement("p");
  body.className = "bon-user-not-found__body";
  body.append(
    "Reddit has no user named ",
    Object.assign(document.createElement("code"), {
      className: "bon-user-not-found__name bon-pii",
      textContent: `u/${username}`,
    }),
    ". Check the spelling — or the account may have been deleted."
  );
  wrap.appendChild(body);

  return wrap;
}
