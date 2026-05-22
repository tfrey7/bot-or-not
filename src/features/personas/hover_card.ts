// Singleton floating card shown when the cursor enters a personas-scatter
// dot. Mirrors the persona preview from the Reddit profile-page panel:
// persona label + radar + summary on top, HUMAN/BOT signals list below.
// Reuses bonReportsPersonaBlock / bonTopReasonsList so the visual matches
// the reports detail pane exactly — no parallel CSS to keep in sync.
//
// The card is non-interactive (pointer-events: none) so it can render
// anywhere without stealing the mouseleave that closes it.

import type { Report } from "../../types.ts";
import { bonReportsPersonaBlock } from "../reports/persona_block.ts";
import { bonTopReasonsList } from "../../utils/top_reasons_list.ts";
import { bonNormalizeInvestigation } from "../../verdict.ts";

let activeCard: HTMLElement | null = null;
let activeUsername: string | null = null;

const CARD_WIDTH = 360;

export function bonPersonasShowHover(
  username: string,
  report: Report | null,
  anchorRect: DOMRect
): void {
  if (activeUsername === username && activeCard) {
    positionCard(activeCard, anchorRect);
    return;
  }

  bonPersonasHideHover();

  const card = buildCard(username, report);
  if (!card) {
    return;
  }

  document.body.appendChild(card);
  positionCard(card, anchorRect);

  activeCard = card;
  activeUsername = username;
}

export function bonPersonasHideHover(): void {
  if (!activeCard) {
    return;
  }

  activeCard.remove();
  activeCard = null;
  activeUsername = null;
}

function buildCard(
  username: string,
  report: Report | null
): HTMLElement | null {
  const investigation = bonNormalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );

  if (investigation?.status !== "done") {
    return null;
  }

  const { persona, summary, factors } = investigation.results;

  const card = document.createElement("div");
  card.className = "bon-personas-hover-card";

  const header = document.createElement("p");
  header.className = "bon-personas-hover-card__username bon-pii";
  header.textContent = `u/${username}`;
  card.appendChild(header);

  const personaBlock = persona?.label
    ? bonReportsPersonaBlock(persona, { summary })
    : null;

  if (personaBlock) {
    card.appendChild(personaBlock);
  }

  const reasonsList =
    factors.length > 0 ? bonTopReasonsList(factors, { perSide: 2 }) : null;

  if (reasonsList) {
    card.appendChild(reasonsList);
  }

  if (!personaBlock && !reasonsList) {
    return null;
  }

  return card;
}

function positionCard(card: HTMLElement, anchorRect: DOMRect): void {
  const margin = 12;
  const gap = 14;

  const width = card.offsetWidth || CARD_WIDTH;
  const height = card.offsetHeight || 280;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const anchorCenterX = anchorRect.left + anchorRect.width / 2;

  // Prefer the side of the dot with more room — keeps the card from
  // covering the chart when the dot is near a viewport edge.
  const rightRoom = vw - anchorRect.right - gap - margin;
  const leftRoom = anchorRect.left - gap - margin;
  const preferRight = rightRoom >= width || rightRoom >= leftRoom;

  let left = preferRight
    ? anchorRect.right + gap
    : anchorRect.left - gap - width;

  left = Math.max(
    margin,
    Math.min(left, vw - margin - width, anchorCenterX + width)
  );

  if (left < margin) {
    left = margin;
  }

  let top = anchorRect.top + anchorRect.height / 2 - height / 2;
  top = Math.max(margin, Math.min(top, vh - margin - height));

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
