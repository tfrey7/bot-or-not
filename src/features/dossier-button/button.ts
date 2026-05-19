// Pure DOM construction for the "Add context" pill that the dossier-button
// feature injects into Reddit post + comment action rows. No I/O, no
// MutationObserver — index.ts owns those.

export type DossierButtonState = "default" | "loading" | "added" | "error";

export interface DossierButtonRefs {
  root: HTMLButtonElement;
  label: HTMLSpanElement;
}

export function bonDossierBtnBuild(opts: {
  username: string;
  permalink: string;
  kind: "post" | "comment";
}): DossierButtonRefs {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `bon-dossier-btn bon-dossier-btn--${opts.kind}`;
  button.dataset.bonDossierFor = opts.username.toLowerCase();
  button.dataset.bonDossierPermalink = opts.permalink;
  button.dataset.bonDossierKind = opts.kind;

  const label = document.createElement("span");
  label.className = "bon-dossier-btn__label";

  button.appendChild(label);

  bonDossierBtnSetState({ root: button, label }, "default");

  return { root: button, label };
}

export function bonDossierBtnSetState(
  refs: DossierButtonRefs,
  state: DossierButtonState,
  errorMessage?: string
): void {
  const { root, label } = refs;
  root.dataset.bonDossierState = state;
  root.classList.remove(
    "bon-dossier-btn--default",
    "bon-dossier-btn--loading",
    "bon-dossier-btn--added",
    "bon-dossier-btn--error"
  );
  root.classList.add(`bon-dossier-btn--${state}`);

  if (state === "loading") {
    label.textContent = "Saving…";
    root.title = "Saving to dossier";
    root.disabled = true;
    return;
  }

  if (state === "added") {
    label.textContent = "Context added";
    root.title = "Click to remove from dossier";
    root.disabled = false;
    return;
  }

  if (state === "error") {
    label.textContent = "Couldn't save";
    root.title = errorMessage || "Failed to save to dossier — click to retry";
    root.disabled = false;
    return;
  }

  label.textContent = "Add context";
  root.title = "Save this to the dossier for this user";
  root.disabled = false;
}
