// "Your notes" panel in the detail pane. One editable note + persona pick
// per username, saved on every change. Sits independently of the AI
// investigation so the operator's own call is recorded even when no
// verdict has been computed yet (or when they disagree with one).
//
// Save strategy: picker writes on change; textarea writes on `input`
// (debounced) and on `blur` (immediate). The status pill reflects state:
// "Unsaved" → "Saving…" → "Saved <relative>".

import { bonClientSend } from "../../client.ts";
import type { PersonaLabel, UserNotes } from "../../types.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import type { ReportRow } from "./logic.ts";
import { bonRedditorsPersonaPicker } from "./persona_picker.ts";

const SAVE_DEBOUNCE_MS = 600;

export function bonRedditorsUserNotesSection(
  report: ReportRow
): HTMLDivElement {
  const { username, userNotes } = report;

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap bon-user-notes";

  const titleRow = document.createElement("div");
  titleRow.className = "bon-user-notes__title-row";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Your notes";
  titleRow.appendChild(title);

  const status = document.createElement("span");
  status.className = "bon-user-notes__status";
  titleRow.appendChild(status);

  wrap.appendChild(titleRow);

  const controls = document.createElement("div");
  controls.className = "bon-user-notes__controls";

  const ratingWrap = document.createElement("div");
  ratingWrap.className = "bon-user-notes__rating";

  const ratingLabel = document.createElement("span");
  ratingLabel.className = "bon-user-notes__rating-label";
  ratingLabel.textContent = "Your call";
  ratingWrap.appendChild(ratingLabel);

  let currentRatings: PersonaLabel[] = [...(userNotes?.ratings ?? [])];
  const picker = bonRedditorsPersonaPicker({
    values: currentRatings,
    onChange: (next) => {
      currentRatings = next;
      renderStatus(userNotes ?? null);
      void save();
    },
  });
  ratingWrap.appendChild(picker.element);

  controls.appendChild(ratingWrap);
  wrap.appendChild(controls);

  const textarea = document.createElement("textarea");
  textarea.className = "bon-user-notes__textarea";
  textarea.placeholder =
    "What did you spot? Why you flagged this one, anything to remember next time you see them…";
  textarea.value = userNotes?.note ?? "";
  textarea.rows = 4;
  wrap.appendChild(textarea);

  let lastSavedNote = userNotes?.note ?? "";
  let lastSavedRatings: PersonaLabel[] = [...(userNotes?.ratings ?? [])];
  let pendingSave = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function ratingsEqual(a: PersonaLabel[], b: PersonaLabel[]): boolean {
    if (a.length !== b.length) {
      return false;
    }

    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }

    return true;
  }

  function renderStatus(saved: UserNotes | null): void {
    if (pendingSave) {
      status.textContent = "Saving…";
      status.classList.remove(
        "bon-user-notes__status--dirty",
        "bon-user-notes__status--saved"
      );

      return;
    }

    const dirty =
      textarea.value !== lastSavedNote ||
      !ratingsEqual(currentRatings, lastSavedRatings);

    if (dirty) {
      status.textContent = "Unsaved";
      status.classList.add("bon-user-notes__status--dirty");
      status.classList.remove("bon-user-notes__status--saved");
      return;
    }

    if (saved && saved.updatedAt) {
      status.textContent = `Saved ${bonFormatDate(saved.updatedAt)}`;
      status.classList.add("bon-user-notes__status--saved");
      status.classList.remove("bon-user-notes__status--dirty");
      return;
    }

    status.textContent = "";
    status.classList.remove(
      "bon-user-notes__status--dirty",
      "bon-user-notes__status--saved"
    );
  }

  async function save(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    pendingSave = true;
    renderStatus(userNotes ?? null);

    try {
      const response = await bonClientSend<{
        ok?: boolean;
        userNotes?: UserNotes | null;
      }>({
        type: "set-user-notes",
        username,
        ratings: currentRatings,
        note: textarea.value,
      });

      if (response?.ok) {
        lastSavedNote = textarea.value.trim() === "" ? "" : textarea.value;
        lastSavedRatings = [...currentRatings];
        pendingSave = false;
        renderStatus(response.userNotes ?? null);
      } else {
        pendingSave = false;
        status.textContent = "Save failed";
      }
    } catch (error) {
      pendingSave = false;
      console.error("[Bot or Not] save user notes failed", error);
      status.textContent = "Save failed";
    }
  }

  function scheduleSave(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void save();
    }, SAVE_DEBOUNCE_MS);
  }

  textarea.addEventListener("input", () => {
    renderStatus(userNotes ?? null);
    scheduleSave();
  });

  textarea.addEventListener("blur", () => {
    if (debounceTimer) {
      void save();
    }
  });

  renderStatus(userNotes ?? null);

  return wrap;
}
