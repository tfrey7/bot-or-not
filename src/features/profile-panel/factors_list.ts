// The detailed per-factor cards rendered in the expanded panel body. One
// card per canonical factor key (in factors.js order); factors absent from
// the stored investigation render as "added later" placeholders so old
// reports stay readable without re-running.

import { BON_FACTOR_KEYS, BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";

interface FactorWithName extends Factor {
  name?: string;
}

function buildMissingFactor(key: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-panel-factor bon-panel-factor--new";

  const header = document.createElement("div");
  header.className = "bon-panel-factor__header";

  const name = document.createElement("span");
  name.className = "bon-panel-factor__name";
  name.textContent = BON_FACTOR_LABELS[key] || key;
  header.appendChild(name);

  const pill = document.createElement("span");
  pill.className = "bon-panel-factor__signal bon-panel-factor__signal--new";
  pill.textContent = "Added later";
  header.appendChild(pill);

  li.appendChild(header);

  const note = document.createElement("div");
  note.className =
    "bon-panel-factor__reasoning bon-panel-factor__reasoning--muted";

  note.textContent =
    "Added after this investigation ran — re-run to include it.";

  li.appendChild(note);

  return li;
}

function buildFactor(factor: FactorWithName): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-panel-factor";

  const header = document.createElement("div");
  header.className = "bon-panel-factor__header";

  const name = document.createElement("span");
  name.className = "bon-panel-factor__name";

  name.textContent =
    BON_FACTOR_LABELS[factor.key] || factor.name || factor.key || "Factor";

  header.appendChild(name);

  if (typeof factor.score === "number") {
    const leaning = bonScoreLeaning(factor.score, factor.confidence);

    const pill = document.createElement("span");
    pill.className = `bon-panel-factor__signal bon-panel-factor__signal--${leaning}`;

    pill.textContent =
      leaning === "neutral" ? "Neutral" : bonFormatVerdict(leaning);

    header.appendChild(pill);
  }

  li.appendChild(header);

  if (factor.reasoning) {
    const reasoning = document.createElement("div");
    reasoning.className = "bon-panel-factor__reasoning";
    reasoning.appendChild(bonLinkifyReddit(factor.reasoning));
    li.appendChild(reasoning);
  }

  return li;
}

export function bonPanelBuildFactorsList(factors: Factor[]): HTMLUListElement {
  const byKey = new Map<string, FactorWithName>(
    factors.map((factor) => [factor.key, factor as FactorWithName])
  );

  const ul = document.createElement("ul");
  ul.className = "bon-panel-factors";

  for (const key of BON_FACTOR_KEYS) {
    const factor = byKey.get(key);
    if (factor) {
      ul.appendChild(buildFactor(factor));
    } else {
      ul.appendChild(buildMissingFactor(key));
    }
  }

  return ul;
}
