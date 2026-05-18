// Per-factor cards rendered inside the expanded investigation detail row.
// Walks the canonical key list so factors added since the report ran
// appear as "added later" placeholder cards in the right position, and
// stored factors that have since been removed from the schema are dropped
// silently.

import { BON_FACTOR_KEYS, BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";
import { bonReportsScoreBar } from "./score_bar.ts";

interface FactorWithExtras extends Factor {
  name?: string;
  evidence?: string | string[];
}

function factorLabel(f: FactorWithExtras): string {
  if (f.key && BON_FACTOR_LABELS[f.key]) {
    return BON_FACTOR_LABELS[f.key];
  }

  if (f.name) {
    return f.name.replace(/_/g, " ");
  }

  return f.key || "Factor";
}

function renderMissingFactor(key: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-factor bon-factor--new";

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
  li.appendChild(meta);

  const note = document.createElement("div");
  note.className = "bon-factor-content";

  const inner = document.createElement("div");
  inner.className = "bon-factor-reasoning bon-factor-reasoning--muted";
  inner.textContent =
    "Added after this investigation ran. Re-run the investigation to include this factor in the verdict.";

  note.appendChild(inner);
  li.appendChild(note);

  return li;
}

function renderFactor(f: FactorWithExtras): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-factor";

  const meta = document.createElement("div");
  meta.className = "bon-factor-meta";

  const header = document.createElement("div");
  header.className = "bon-factor-header";

  const name = document.createElement("span");
  name.className = "bon-factor-name";
  name.textContent = factorLabel(f);
  header.appendChild(name);

  if (typeof f.score === "number") {
    const leaning = bonScoreLeaning(f.score, f.confidence);

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

  if (typeof f.score === "number") {
    meta.appendChild(bonReportsScoreBar(f.score, f.confidence));
  }

  const subMetaParts: string[] = [];
  if (typeof f.confidence === "number") {
    subMetaParts.push(`${Math.round(f.confidence * 100)}% confidence`);
  }

  if (subMetaParts.length) {
    const sm = document.createElement("div");
    sm.className = "bon-factor-confidence";
    sm.textContent = subMetaParts.join(" · ");
    meta.appendChild(sm);
  }

  li.appendChild(meta);

  const content = document.createElement("div");
  content.className = "bon-factor-content";

  if (f.reasoning) {
    const r = document.createElement("div");
    r.className = "bon-factor-reasoning";
    r.textContent = f.reasoning;
    content.appendChild(r);
  }

  if (Array.isArray(f.evidence) && f.evidence.length) {
    const ev = document.createElement("ul");
    ev.className = "bon-factor-evidence";
    for (const cite of f.evidence) {
      const item = document.createElement("li");
      item.textContent = cite;
      ev.appendChild(item);
    }
    content.appendChild(ev);
  }

  li.appendChild(content);
  return li;
}

export function bonReportsFactorsList(factors: Factor[]): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "bon-verdict-factors";

  const byKey = new Map<string, FactorWithExtras>(
    factors.map((f) => [f.key, f as FactorWithExtras])
  );

  for (const key of BON_FACTOR_KEYS) {
    const f = byKey.get(key);
    if (f) {
      ul.appendChild(renderFactor(f));
    } else {
      ul.appendChild(renderMissingFactor(key));
    }
  }
  return ul;
}
