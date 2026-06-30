// Custom persona multi-picker for the user-notes widget. Native <select
// multiple> renders as an inline list that doesn't fit the row's layout
// and still can't show per-option color stripes on macOS (the OS menu
// shell ignores option background colors). This rolls a button + popover
// listbox pair instead. Behavior parity with a real multi-select on the
// points that matter: keyboard-openable, Escape to close, click-outside
// to dismiss, click/Enter toggles inclusion, menu stays open while
// toggling — so the user can pick multiple personas without reopening.
//
// API: caller passes the current set of picks and a change callback. The
// picker reports back on every toggle with the new array (in user pick
// order, de-duped).

import { ARCHETYPES, PERSONA_LABELS } from "../../factors.ts";
import type { PersonaLabel } from "../../types.ts";

export interface PersonaPickerOptions {
  values: PersonaLabel[];
  onChange: (next: PersonaLabel[]) => void;
}

export interface PersonaPickerHandle {
  element: HTMLDivElement;
  setValues: (next: PersonaLabel[]) => void;
}

const ARCHETYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ARCHETYPES.map((archetype) => [archetype.key, archetype.label])
);

const EXTRA_LABEL_MAP: Record<string, string> = {
  bot: "Bot",
  app: "App",
  normal: "Normal",
};

function labelFor(value: PersonaLabel): string {
  return ARCHETYPE_LABEL_MAP[value] || EXTRA_LABEL_MAP[value] || value;
}

export function redditorsPersonaPicker(
  opts: PersonaPickerOptions
): PersonaPickerHandle {
  const wrap = document.createElement("div");
  wrap.className = "bon-persona-picker";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "bon-persona-picker__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  // One chip per picked persona — stripe sits next to its own label so
  // the color cue stays attached to what it represents instead of
  // floating in a separate column. Re-rendered on every toggle.
  const triggerLabel = document.createElement("span");
  triggerLabel.className = "bon-persona-picker__trigger-label";
  trigger.appendChild(triggerLabel);

  const chevron = document.createElement("span");
  chevron.className = "bon-persona-picker__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  trigger.appendChild(chevron);

  const menu = document.createElement("div");
  menu.className = "bon-persona-picker__menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-multiselectable", "true");
  menu.hidden = true;

  const items: { key: PersonaLabel; el: HTMLDivElement }[] = [];

  for (const key of PERSONA_LABELS) {
    const item = document.createElement("div");
    item.className = `bon-persona-picker__option bon-persona-picker__option--${key}`;
    item.setAttribute("role", "option");
    item.dataset.bonValue = key;
    item.tabIndex = -1;

    const stripe = document.createElement("span");
    stripe.className = `bon-persona-picker__stripe bon-persona-picker__stripe--${key}`;
    stripe.setAttribute("aria-hidden", "true");
    item.appendChild(stripe);

    const check = document.createElement("span");
    check.className = "bon-persona-picker__check";
    check.setAttribute("aria-hidden", "true");
    item.appendChild(check);

    const text = document.createElement("span");
    text.className = "bon-persona-picker__option-label";
    text.textContent = labelFor(key);
    item.appendChild(text);

    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    item.addEventListener("click", () => {
      toggle(key);
    });

    items.push({ key, el: item });
    menu.appendChild(item);
  }

  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  const currentSet = new Set<PersonaLabel>();
  let focusedIndex = -1;

  function applyValues(next: PersonaLabel[]): void {
    currentSet.clear();

    for (const value of next) {
      if (!currentSet.has(value)) {
        currentSet.add(value);
      }
    }

    render();
  }

  function render(): void {
    const ordered = Array.from(currentSet);

    triggerLabel.replaceChildren();

    if (ordered.length === 0) {
      triggerLabel.classList.add("bon-persona-picker__trigger-label--empty");
      triggerLabel.textContent = "— no call —";
    } else {
      triggerLabel.classList.remove("bon-persona-picker__trigger-label--empty");

      for (const key of ordered) {
        const chip = document.createElement("span");
        chip.className = `bon-persona-picker__chip bon-persona-picker__chip--${key}`;

        const stripe = document.createElement("span");
        stripe.className = `bon-persona-picker__stripe bon-persona-picker__stripe--${key}`;
        stripe.setAttribute("aria-hidden", "true");
        chip.appendChild(stripe);

        const text = document.createElement("span");
        text.className = "bon-persona-picker__chip-label";
        text.textContent = labelFor(key);
        chip.appendChild(text);

        triggerLabel.appendChild(chip);
      }
    }

    for (const { key, el } of items) {
      const picked = currentSet.has(key);
      el.setAttribute("aria-selected", picked ? "true" : "false");
    }
  }

  function toggle(key: PersonaLabel): void {
    if (currentSet.has(key)) {
      currentSet.delete(key);
    } else {
      currentSet.add(key);
    }

    render();
    opts.onChange(Array.from(currentSet));
  }

  function setFocusedIndex(index: number): void {
    if (index < 0 || index >= items.length) {
      return;
    }

    focusedIndex = index;

    for (let i = 0; i < items.length; i++) {
      items[i].el.classList.toggle(
        "bon-persona-picker__option--focused",
        i === index
      );
    }

    items[index].el.scrollIntoView({ block: "nearest" });
  }

  function open(): void {
    if (!menu.hidden) {
      return;
    }

    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");

    const ordered = Array.from(currentSet);
    const firstPicked = ordered[0];
    const startIndex = firstPicked
      ? items.findIndex(({ key }) => key === firstPicked)
      : 0;
    setFocusedIndex(startIndex >= 0 ? startIndex : 0);

    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKey, true);
  }

  function close(): void {
    if (menu.hidden) {
      return;
    }

    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    focusedIndex = -1;

    for (const { el } of items) {
      el.classList.remove("bon-persona-picker__option--focused");
    }

    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onKey, true);
  }

  function onDocMouseDown(event: MouseEvent): void {
    if (!wrap.contains(event.target as Node)) {
      close();
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex(Math.min(items.length - 1, focusedIndex + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedIndex(Math.max(0, focusedIndex - 1));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setFocusedIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setFocusedIndex(items.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      if (focusedIndex < 0) {
        return;
      }

      event.preventDefault();
      toggle(items[focusedIndex].key);
    }
  }

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (menu.hidden) {
      open();
    } else {
      close();
    }
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (menu.hidden) {
        open();
      }
    }
  });

  applyValues(opts.values);

  return {
    element: wrap,
    setValues: applyValues,
  };
}
