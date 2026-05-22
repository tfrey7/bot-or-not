// Read-only "Your notes" strip rendered in the flyout below the preview.
// Surfaces what the operator wrote on the reports page, in-context while
// browsing Reddit. Returns null when the operator has neither a rating nor
// a note for this user — nothing to show, no chrome.

import { BON_ARCHETYPES } from "../../factors.ts";
import type { PersonaLabel, UserNotes } from "../../types.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";

const ARCHETYPE_META: Record<string, { label: string; hue: number }> =
  Object.fromEntries(
    BON_ARCHETYPES.map((a) => [a.key, { label: a.label, hue: a.hue }])
  );

const EXTRA_LABELS: Record<string, string> = {
  bot: "Bot",
  normal: "Normal",
};

function bonPanelNotesChipLabel(value: PersonaLabel): string {
  return ARCHETYPE_META[value]?.label || EXTRA_LABELS[value] || value;
}

function bonPanelNotesChipHue(value: PersonaLabel): number | null {
  return ARCHETYPE_META[value]?.hue ?? null;
}

export function bonPanelBuildNotesStrip(
  userNotes: UserNotes | null | undefined
): HTMLElement | null {
  const ratings = userNotes?.ratings ?? [];
  const note = (userNotes?.note ?? "").trim();

  if (ratings.length === 0 && note === "") {
    return null;
  }

  const wrap = document.createElement("section");
  wrap.className = "bon-panel-notes";

  const heading = document.createElement("p");
  heading.className = "bon-panel-notes__heading";
  heading.textContent = "Your notes";
  wrap.appendChild(heading);

  if (ratings.length > 0) {
    const chips = document.createElement("ul");
    chips.className = "bon-panel-notes__chips";

    for (const rating of ratings) {
      const chip = document.createElement("li");
      chip.className = "bon-panel-notes__chip";

      const stripe = document.createElement("span");
      stripe.className = "bon-panel-notes__stripe";
      const hue = bonPanelNotesChipHue(rating);
      if (hue !== null) {
        stripe.style.setProperty("--bon-persona-hue", String(hue));
      } else {
        stripe.classList.add("bon-panel-notes__stripe--neutral");
      }

      chip.appendChild(stripe);

      const label = document.createElement("span");
      label.className = "bon-panel-notes__chip-label";
      label.textContent = bonPanelNotesChipLabel(rating);
      chip.appendChild(label);

      chips.appendChild(chip);
    }

    wrap.appendChild(chips);
  }

  if (note !== "") {
    const noteEl = document.createElement("p");
    noteEl.className = "bon-panel-notes__note";
    noteEl.appendChild(bonLinkifyReddit(note));
    wrap.appendChild(noteEl);
  }

  return wrap;
}
