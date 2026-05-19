// "Top reasons" bullet list shown above the per-factor cards in the
// expanded investigation detail row. Ranks factors by decisiveness so the
// summary surfaces the two or three signals that actually moved the
// verdict.

import { BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor } from "../../types.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";
import { bonTopReasons } from "../../verdict.ts";

export function bonReportsTopReasonsList(
  factors: Factor[]
): HTMLUListElement | null {
  const top = bonTopReasons(factors, 3);

  if (!top.length) {
    return null;
  }

  const list = document.createElement("ul");
  list.className = "bon-top-reasons";

  for (const factor of top) {
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
      text.appendChild(document.createTextNode(` — ${factor.reasoning}`));
    }

    listItem.appendChild(text);
    list.appendChild(listItem);
  }
  return list;
}
