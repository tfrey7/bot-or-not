// Custom persona dropdown for the user-notes widget. Native <select> can't
// render per-option color stripes on macOS (the OS menu shell ignores
// option background colors), so this rolls a tiny button + popover listbox
// pair instead. Behavior parity with the native control on the points that
// matter: keyboard-openable, Escape to close, click-outside to dismiss.
//
// API: caller passes the current value and a change callback. The picker
// reports back only when the user picks a different value than the
// current one, so callers can dedupe save side-effects in the same way
// they would for a real <select>'s change event.

import { BON_ARCHETYPES, BON_PERSONA_LABELS } from "../../factors.ts";
import type { PersonaLabel } from "../../types.ts";

export type PersonaPickerValue = PersonaLabel | "";

export interface PersonaPickerOptions {
  value: PersonaPickerValue;
  onChange: (next: PersonaPickerValue) => void;
}

export interface PersonaPickerHandle {
  element: HTMLDivElement;
  setValue: (next: PersonaPickerValue) => void;
}

const ARCHETYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  BON_ARCHETYPES.map((archetype) => [archetype.key, archetype.label])
);

const EXTRA_LABEL_MAP: Record<string, string> = {
  bot: "Bot",
  normal: "Normal",
};

function labelFor(value: PersonaPickerValue): string {
  if (!value) {
    return "— no call —";
  }

  return ARCHETYPE_LABEL_MAP[value] || EXTRA_LABEL_MAP[value] || value;
}

export function bonReportsPersonaPicker(
  opts: PersonaPickerOptions
): PersonaPickerHandle {
  const wrap = document.createElement("div");
  wrap.className = "bon-persona-picker";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "bon-persona-picker__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerStripe = document.createElement("span");
  triggerStripe.className = "bon-persona-picker__stripe";
  triggerStripe.setAttribute("aria-hidden", "true");
  trigger.appendChild(triggerStripe);

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
  menu.hidden = true;

  const valueKeys: PersonaPickerValue[] = ["", ...BON_PERSONA_LABELS];
  const items: { key: PersonaPickerValue; el: HTMLDivElement }[] = [];

  for (const key of valueKeys) {
    const item = document.createElement("div");
    const modifier = key || "empty";
    item.className = `bon-persona-picker__option bon-persona-picker__option--${modifier}`;
    item.setAttribute("role", "option");
    item.dataset.bonValue = key;
    item.tabIndex = -1;

    const stripe = document.createElement("span");
    stripe.className = "bon-persona-picker__stripe";
    stripe.setAttribute("aria-hidden", "true");
    item.appendChild(stripe);

    const text = document.createElement("span");
    text.className = "bon-persona-picker__option-label";
    text.textContent = labelFor(key);
    item.appendChild(text);

    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    item.addEventListener("click", () => {
      if (key !== current) {
        applyValue(key);
        opts.onChange(key);
      }

      close();
    });

    items.push({ key, el: item });
    menu.appendChild(item);
  }

  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  let current: PersonaPickerValue = opts.value;
  let focusedIndex = -1;

  function applyValue(next: PersonaPickerValue): void {
    current = next;
    wrap.dataset.bonValue = next;
    triggerLabel.textContent = labelFor(next);
    triggerLabel.classList.toggle(
      "bon-persona-picker__trigger-label--empty",
      !next
    );

    for (const { key, el } of items) {
      el.setAttribute("aria-selected", key === next ? "true" : "false");
    }
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

    const selectedIndex = items.findIndex(({ key }) => key === current);
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);

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
      const { key } = items[focusedIndex];
      if (key !== current) {
        applyValue(key);
        opts.onChange(key);
      }

      close();
      trigger.focus();
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

  applyValue(opts.value);

  return {
    element: wrap,
    setValue: applyValue,
  };
}
