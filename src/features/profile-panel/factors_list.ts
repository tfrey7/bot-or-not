// The detailed per-factor cards rendered in the expanded panel body. One
// card per canonical factor key (in factors.js order); factors absent from
// the stored investigation render as "added later" placeholders so old
// reports stay readable without re-running.

import { BON_FACTOR_KEYS, BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
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

function buildFactor(f: FactorWithName): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-panel-factor";

  const header = document.createElement("div");
  header.className = "bon-panel-factor__header";

  const name = document.createElement("span");
  name.className = "bon-panel-factor__name";

  name.textContent = BON_FACTOR_LABELS[f.key] || f.name || f.key || "Factor";

  header.appendChild(name);

  if (typeof f.score === "number") {
    const leaning = bonScoreLeaning(f.score, f.confidence);

    const pill = document.createElement("span");
    pill.className = `bon-panel-factor__signal bon-panel-factor__signal--${leaning}`;

    pill.textContent =
      leaning === "neutral" ? "Neutral" : bonFormatVerdict(leaning);

    header.appendChild(pill);
  }

  li.appendChild(header);

  if (f.reasoning) {
    const r = document.createElement("div");
    r.className = "bon-panel-factor__reasoning";
    r.textContent = f.reasoning;
    li.appendChild(r);
  }

  return li;
}

export function bonPanelBuildFactorsList(factors: Factor[]): HTMLUListElement {
  const byKey = new Map<string, FactorWithName>(
    factors.map((f) => [f.key, f as FactorWithName])
  );

  const ul = document.createElement("ul");
  ul.className = "bon-panel-factors";

  for (const key of BON_FACTOR_KEYS) {
    const f = byKey.get(key);
    if (f) {
      ul.appendChild(buildFactor(f));
    } else {
      ul.appendChild(buildMissingFactor(key));
    }
  }

  return ul;
}
