// "Top reasons" bullet list shown above the per-factor cards in the
// expanded investigation detail row. Ranks factors by decisiveness so the
// summary surfaces the two or three signals that actually moved the
// verdict.

import { BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor } from "../../types.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";
import { bonTopReasons } from "../../verdict.ts";

export function bonReportsTopReasonsList(
  factors: Factor[] | null | undefined
): HTMLUListElement | null {
  const top = bonTopReasons(factors, 3);
  if (!top.length) {
    return null;
  }
  const ul = document.createElement("ul");
  ul.className = "bon-top-reasons";
  for (const f of top) {
    const li = document.createElement("li");
    const leaning = bonScoreLeaning(f.score, f.confidence);
    li.className = `bon-reason bon-reason--${leaning}`;
    const bullet = document.createElement("span");
    bullet.className = "bon-reason__bullet";
    bullet.setAttribute("aria-hidden", "true");
    li.appendChild(bullet);
    const text = document.createElement("span");
    text.className = "bon-reason__text";
    const label = document.createElement("strong");
    label.textContent =
      BON_FACTOR_LABELS[f.key] ||
      (f as { name?: string }).name ||
      f.key ||
      "Factor";
    text.appendChild(label);
    if (f.reasoning) {
      text.appendChild(document.createTextNode(` — ${f.reasoning}`));
    }
    li.appendChild(text);
    ul.appendChild(li);
  }
  return ul;
}
