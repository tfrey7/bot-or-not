// Two-column "top reasons" widget — human-leaning signals on the left,
// bot-leaning on the right, each independently ranked by decisiveness.
// Shared between the reports detail view and the profile-panel preview;
// styling is per-context (column-stacking, type scale) and lives in the
// respective stylesheets.

import { BON_FACTOR_LABELS } from "../factors.ts";
import type { Factor } from "../types.ts";
import { bonLinkifyReddit } from "./linkify_reddit.ts";
import { bonScoreLeaning } from "./scoring.ts";
import { bonTopReasonsSplit, type RankedFactor } from "../verdict.ts";

export function bonTopReasonsList(
  factors: Factor[],
  perSide = 3
): HTMLElement | null {
  const split = bonTopReasonsSplit(factors, perSide);

  if (!split.human.length && !split.bot.length) {
    return null;
  }

  const container = document.createElement("div");
  container.className = "bon-top-reasons";

  if (split.human.length) {
    container.appendChild(buildColumn("Human signals", split.human));
  }

  if (split.bot.length) {
    container.appendChild(buildColumn("Bot signals", split.bot));
  }

  return container;
}

function buildColumn(title: string, factors: RankedFactor[]): HTMLDivElement {
  const column = document.createElement("div");
  column.className = "bon-top-reasons__column";

  const heading = document.createElement("p");
  heading.className = "bon-top-reasons__heading";
  heading.textContent = title;
  column.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "bon-top-reasons__list";

  for (const factor of factors) {
    list.appendChild(buildReason(factor));
  }

  column.appendChild(list);

  return column;
}

function buildReason(factor: Factor): HTMLLIElement {
  const listItem = document.createElement("li");
  const leaning = bonScoreLeaning(factor.score, factor.confidence);
  listItem.className = `bon-reason bon-reason--${leaning}`;

  const bullet = document.createElement("span");
  bullet.className = "bon-reason__bullet";
  bullet.setAttribute("aria-hidden", "true");
  listItem.appendChild(bullet);

  const text = document.createElement("span");
  text.className = "bon-reason__text";

  const label = document.createElement("strong");
  label.textContent =
    BON_FACTOR_LABELS[factor.key] ??
    (factor as { name?: string }).name ??
    factor.key;
  text.appendChild(label);

  if (factor.reasoning) {
    text.appendChild(document.createTextNode(" — "));
    text.appendChild(bonLinkifyReddit(factor.reasoning));
  }

  listItem.appendChild(text);

  return listItem;
}
