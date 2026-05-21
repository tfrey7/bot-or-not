// Fun Facts tab — surfaces rarity and extreme observations across every
// completed investigation. Pure derivation from the same Report rows the
// rest of the page uses; clicking a card opens that user's dossier on the
// Reports tab.

import type { Report } from "../../types.ts";
import { bonFunFactsCard } from "./fact_card.ts";
import { bonFunFactsCompute } from "./logic.ts";

export interface BonRenderFunFactsOptions {
  onSelectUser: (username: string) => void;
}

export function bonRenderFunFacts(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null,
  options: BonRenderFunFactsOptions
): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "bon-analytics bon-fun-facts";
  section.appendChild(buildHeader(reports.length));

  const facts = bonFunFactsCompute(reports);
  if (facts.length === 0) {
    section.appendChild(buildEmptyState());
    container.appendChild(section);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "bon-fun-facts-grid";

  for (const fact of facts) {
    grid.appendChild(bonFunFactsCard(fact, options));
  }

  section.appendChild(grid);
  container.appendChild(section);
}

function buildHeader(totalReports: number): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-analytics-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Fun facts";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-analytics-subtitle";
  sub.textContent =
    totalReports === 0
      ? "Nothing in the corpus yet."
      : `Rarities and extremes across ${totalReports} reported user${totalReports === 1 ? "" : "s"}. Click a card to open the dossier.`;
  header.appendChild(sub);

  return header;
}

function buildEmptyState(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "bon-analytics-empty";
  div.textContent =
    "Nothing fun yet — run an investigation or two and rarities will surface here.";

  return div;
}
