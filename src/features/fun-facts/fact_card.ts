// Single Fun Fact card. Renders the title, the big highlight, the linked
// username, the body sentence, and (optionally) a rarity chip. Clicking
// anywhere on the card invokes the page-level navigate callback so the
// reports tab opens to that user's dossier.

import type { BonFunFact } from "./logic.ts";

export interface BonFunFactCardOptions {
  onSelectUser: (username: string) => void;
}

export function bonFunFactsCard(
  fact: BonFunFact,
  options: BonFunFactCardOptions
): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `bon-fun-fact bon-fun-fact--${fact.kind}`;
  card.disabled = !fact.username;

  if (fact.hue != null) {
    card.style.setProperty("--bon-fun-fact-hue", String(Math.round(fact.hue)));
    card.classList.add("bon-fun-fact--tinted");
  }

  if (fact.badge) {
    const badge = document.createElement("span");
    badge.className = "bon-fun-fact-badge";
    badge.textContent = fact.badge;
    card.appendChild(badge);
  }

  const title = document.createElement("p");
  title.className = "bon-fun-fact-title";
  title.textContent = fact.title;
  card.appendChild(title);

  const highlight = document.createElement("p");
  highlight.className = "bon-fun-fact-highlight";
  highlight.textContent = fact.highlight;
  card.appendChild(highlight);

  if (fact.username) {
    const subject = document.createElement("p");
    subject.className = "bon-fun-fact-subject";
    subject.textContent = `u/${fact.username}`;
    card.appendChild(subject);
  }

  const detail = document.createElement("p");
  detail.className = "bon-fun-fact-detail";
  detail.textContent = fact.detail;
  card.appendChild(detail);

  if (fact.username) {
    const username = fact.username;
    card.addEventListener("click", () => {
      options.onSelectUser(username);
    });
  }

  return card;
}
