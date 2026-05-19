// Per-factor cards rendered inside the expanded investigation detail row.
// Walks the canonical key list so factors added since the report ran
// appear as "added later" placeholder cards in the right position, and
// stored factors that have since been removed from the schema are dropped
// silently.

import { BON_FACTOR_KEYS, BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";
import { bonReportsScoreBar } from "./score_bar.ts";

interface FactorWithExtras extends Factor {
  name?: string;
  evidence?: string | string[];
}

function factorLabel(factor: FactorWithExtras): string {
  if (factor.key && BON_FACTOR_LABELS[factor.key]) {
    return BON_FACTOR_LABELS[factor.key];
  }

  if (factor.name) {
    return factor.name.replace(/_/g, " ");
  }

  return factor.key || "Factor";
}

function renderMissingFactor(key: string): HTMLLIElement {
  const listItem = document.createElement("li");
  listItem.className = "bon-factor bon-factor--new";

  const meta = document.createElement("div");
  meta.className = "bon-factor-meta";

  const header = document.createElement("div");
  header.className = "bon-factor-header";

  const name = document.createElement("span");
  name.className = "bon-factor-name";
  name.textContent = BON_FACTOR_LABELS[key] || key;
  header.appendChild(name);

  const pill = document.createElement("span");
  pill.className = "bon-factor-signal bon-factor-signal--new";
  pill.textContent = "Added later";
  header.appendChild(pill);

  meta.appendChild(header);
  listItem.appendChild(meta);

  const note = document.createElement("div");
  note.className = "bon-factor-content";

  const inner = document.createElement("div");
  inner.className = "bon-factor-reasoning bon-factor-reasoning--muted";
  inner.textContent =
    "Added after this investigation ran. Re-run the investigation to include this factor in the verdict.";

  note.appendChild(inner);
  listItem.appendChild(note);

  return listItem;
}

function renderFactor(factor: FactorWithExtras): HTMLLIElement {
  const leaning =
    typeof factor.score === "number"
      ? bonScoreLeaning(factor.score, factor.confidence)
      : "neutral";

  const listItem = document.createElement("li");
  listItem.className = `bon-factor bon-factor--${leaning}`;

  const meta = document.createElement("div");
  meta.className = "bon-factor-meta";

  const header = document.createElement("div");
  header.className = "bon-factor-header";

  const name = document.createElement("span");
  name.className = "bon-factor-name";
  name.textContent = factorLabel(factor);
  header.appendChild(name);

  if (typeof factor.score === "number") {
    const pill = document.createElement("span");
    const pillClass =
      leaning === "likely-bot"
        ? "bot"
        : leaning === "likely-human"
          ? "human"
          : leaning;

    pill.className = `bon-factor-signal bon-factor-signal--${pillClass}`;
    pill.textContent =
      leaning === "neutral" ? "Neutral" : bonFormatVerdict(leaning);
    header.appendChild(pill);
  }
  meta.appendChild(header);

  if (typeof factor.score === "number") {
    meta.appendChild(bonReportsScoreBar(factor.score, factor.confidence));
  }

  const subMetaParts: string[] = [];
  if (typeof factor.confidence === "number") {
    subMetaParts.push(`${Math.round(factor.confidence * 100)}% confidence`);
  }

  if (subMetaParts.length) {
    const subMeta = document.createElement("div");
    subMeta.className = "bon-factor-confidence";
    subMeta.textContent = subMetaParts.join(" · ");
    meta.appendChild(subMeta);
  }

  listItem.appendChild(meta);

  const content = document.createElement("div");
  content.className = "bon-factor-content";

  if (factor.reasoning) {
    const reasoning = document.createElement("div");
    reasoning.className = "bon-factor-reasoning";
    reasoning.appendChild(bonLinkifyReddit(factor.reasoning));
    content.appendChild(reasoning);
  }

  if (Array.isArray(factor.evidence) && factor.evidence.length) {
    const evidence = document.createElement("ul");
    evidence.className = "bon-factor-evidence";
    for (const cite of factor.evidence) {
      const item = document.createElement("li");
      item.appendChild(bonLinkifyReddit(cite));
      evidence.appendChild(item);
    }
    content.appendChild(evidence);
  }

  listItem.appendChild(content);
  return listItem;
}

export function bonReportsFactorsList(factors: Factor[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "bon-verdict-factors";

  const byKey = new Map<string, FactorWithExtras>(
    factors.map((factor) => [factor.key, factor as FactorWithExtras])
  );

  for (const key of BON_FACTOR_KEYS) {
    const factor = byKey.get(key);
    if (factor) {
      list.appendChild(renderFactor(factor));
    } else {
      list.appendChild(renderMissingFactor(key));
    }
  }
  return list;
}
