// Tiny monospace pill that identifies which manually-linked ring a user
// belongs to. Same component used in the reports table row, the inline tag
// next to in-feed username links, and the profile panel header.

import { bonRingHue } from "./ring_id.ts";

export function bonRingChip(ringId: string | null): HTMLElement | null {
  if (!ringId) {
    return null;
  }

  const chip = document.createElement("span");
  chip.className = "bon-ring-chip";
  chip.textContent = `[${ringId}]`;
  chip.title = `Ring ${ringId}`;
  chip.dataset.bonRingId = ringId;
  chip.style.setProperty("--bon-ring-hue", String(bonRingHue(ringId)));
  return chip;
}
