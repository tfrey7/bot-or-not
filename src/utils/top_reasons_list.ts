// Two-column "top reasons" widget — human-leaning signals on the left,
// bot-leaning on the right, each independently ranked by decisiveness.
// Shared between the reports detail view and the profile-panel preview;
// styling is per-context (column-stacking, type scale) and lives in the
// respective stylesheets.

import type { Factor } from "../types.ts";
import { bonLinkifyReddit, type BonLinkifyOptions } from "./linkify_reddit.ts";
import { bonScoreLeaning } from "./scoring.ts";
import { bonTopReasonsSplit, type RankedFactor } from "../verdict.ts";

export interface BonTopReasonsOptions {
  perSide?: number;
  linkify?: BonLinkifyOptions;
}

export function bonTopReasonsList(
  factors: Factor[],
  options: BonTopReasonsOptions = {}
): HTMLElement | null {
  const perSide = options.perSide ?? 3;
  const split = bonTopReasonsSplit(factors, perSide);

  if (!split.human.length && !split.bot.length) {
    return null;
  }

  const container = document.createElement("div");
  container.className = "bon-top-reasons";

  if (split.human.length) {
    container.appendChild(
      buildColumn("Human signals", split.human, options.linkify)
    );
  }

  if (split.bot.length) {
    container.appendChild(
      buildColumn("Bot signals", split.bot, options.linkify)
    );
  }

  return container;
}

function buildColumn(
  title: string,
  factors: RankedFactor[],
  linkify: BonLinkifyOptions | undefined
): HTMLDivElement {
  const column = document.createElement("div");
  column.className = "bon-top-reasons__column";

  const heading = document.createElement("p");
  heading.className = "bon-top-reasons__heading";
  heading.textContent = title;
  column.appendChild(heading);

  // bon-pii on the list (not the column or container) so the "Human signals" /
  // "Bot signals" labels stay legible while the bullet text redacts.
  const list = document.createElement("ul");
  list.className = "bon-top-reasons__list bon-pii";

  for (const factor of factors) {
    list.appendChild(buildReason(factor, linkify));
  }

  column.appendChild(list);

  return column;
}

function buildReason(
  factor: Factor,
  linkify: BonLinkifyOptions | undefined
): HTMLLIElement {
  const listItem = document.createElement("li");
  const leaning = bonScoreLeaning(factor.score, factor.confidence);
  listItem.className = `bon-reason bon-reason--${leaning}`;

  const bullet = document.createElement("span");
  bullet.className = "bon-reason__bullet";
  bullet.setAttribute("aria-hidden", "true");
  listItem.appendChild(bullet);

  const text = document.createElement("span");
  text.className = "bon-reason__text";

  if (factor.reasoning) {
    text.appendChild(bonLinkifyReddit(factor.reasoning, linkify));
  }

  listItem.appendChild(text);

  return listItem;
}
