// Compact factor strip rendered in the always-visible "Factors" cell.
// Each dot is a small colored square tinted by its signal leaning. On
// hover/focus the dot surfaces a richer card-style popover with reasoning
// + evidence + a score bar. The popover sits in the dot's DOM so a single
// CSS rule (:hover/:focus-within) reveals it; positioning is hoisted to
// <body> to escape table-cell containing blocks.

import { BON_FACTOR_KEYS, BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor, Investigation } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";
import { bonReportsScoreBar } from "./score_bar.ts";

// Factor with the loose `evidence` shape callers sometimes pass (an
// array of citation strings).
interface FactorWithEvidence extends Factor {
  evidence?: string | string[];
}

type DotLeaning =
  | "bot"
  | "likely-bot"
  | "neutral"
  | "likely-human"
  | "human"
  | "missing"
  | "new";

// Factor tooltip is position: fixed and gets hoisted to <body> on first
// hover. The dot lives inside a table cell with its own containing block
// and overflow rules; appending to body guarantees the card sits directly
// under <html> so fixed positioning resolves against the true viewport.
function attachFactorCardPositioning(
  dotEl: HTMLElement,
  cardEl: HTMLElement
): void {
  let mounted = false;

  const show = (): void => {
    if (!mounted) {
      document.body.appendChild(cardEl);
      mounted = true;
    }

    const dotRect = dotEl.getBoundingClientRect();
    const cardWidth = cardEl.offsetWidth;
    const cardHeight = cardEl.offsetHeight;
    if (!cardWidth || !cardHeight) {
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 10;

    let left = dotRect.left + dotRect.width / 2 - cardWidth / 2;
    left = Math.max(margin, Math.min(left, vw - margin - cardWidth));

    let top = dotRect.top - cardHeight - gap;
    if (top < margin) {
      top = dotRect.bottom + gap;
    }
    top = Math.max(margin, Math.min(top, vh - margin - cardHeight));

    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${top}px`;
    cardEl.classList.add("bon-factor-card--visible");
  };

  const hide = (): void => {
    cardEl.classList.remove("bon-factor-card--visible");
  };

  dotEl.addEventListener("mouseenter", show);
  dotEl.addEventListener("mouseleave", hide);
  dotEl.addEventListener("focus", show);
  dotEl.addEventListener("blur", hide);
}

function buildFactorTooltipCard(
  fullLabel: string,
  f: FactorWithEvidence | undefined,
  hasRun: boolean,
  leaning: DotLeaning
): HTMLSpanElement {
  const card = document.createElement("span");
  // Leaning modifier carries --bon-factor-accent forward when the card is
  // hoisted to <body> for positioning; otherwise inheritance from the dot
  // is severed and the colored top border goes muted.
  card.className = `bon-factor-card bon-factor-card--${leaning}`;
  card.setAttribute("role", "tooltip");

  const header = document.createElement("span");
  header.className = "bon-factor-card-header";

  const name = document.createElement("span");
  name.className = "bon-factor-card-name";
  name.textContent = fullLabel;
  header.appendChild(name);

  if (f && typeof f.score === "number") {
    const pillClass =
      leaning === "likely-bot"
        ? "bot"
        : leaning === "likely-human"
          ? "human"
          : leaning === "missing"
            ? "neutral"
            : leaning;

    const pill = document.createElement("span");
    pill.className = `bon-factor-signal bon-factor-signal--${pillClass}`;
    pill.textContent =
      leaning === "neutral" || leaning === "missing"
        ? "Neutral"
        : bonFormatVerdict(leaning);
    header.appendChild(pill);
  }
  card.appendChild(header);

  if (f && typeof f.score === "number") {
    card.appendChild(bonReportsScoreBar(f.score, f.confidence));
  }

  if (f && typeof f.confidence === "number") {
    const conf = document.createElement("span");
    conf.className = "bon-factor-card-confidence";
    conf.textContent = `${Math.round(f.confidence * 100)}% confidence`;
    card.appendChild(conf);
  }

  if (f?.reasoning) {
    const r = document.createElement("span");
    r.className = "bon-factor-card-reasoning";
    r.textContent = f.reasoning;
    card.appendChild(r);
  } else if (!f && hasRun) {
    const r = document.createElement("span");
    r.className = "bon-factor-card-reasoning bon-factor-card-reasoning--muted";
    r.textContent = "Added after this investigation ran — re-run to score.";
    card.appendChild(r);
  } else if (!f) {
    const r = document.createElement("span");
    r.className = "bon-factor-card-reasoning bon-factor-card-reasoning--muted";
    r.textContent = "Not investigated.";
    card.appendChild(r);
  }

  if (f && Array.isArray(f.evidence) && f.evidence.length) {
    const list = document.createElement("ul");
    list.className = "bon-factor-card-evidence";
    for (const cite of f.evidence) {
      const item = document.createElement("li");
      item.textContent = cite;
      list.appendChild(item);
    }
    card.appendChild(list);
  }

  return card;
}

function buildFactorDot(
  key: string,
  f: FactorWithEvidence | undefined,
  hasRun: boolean
): HTMLSpanElement {
  const fullLabel = BON_FACTOR_LABELS[key] || key;

  const dot = document.createElement("span");
  dot.className = "bon-factor-dot";
  dot.tabIndex = 0;

  let leaning: DotLeaning;
  if (f && typeof f.score === "number") {
    leaning = bonScoreLeaning(f.score, f.confidence) as DotLeaning;
  } else if (!f && hasRun) {
    leaning = "new";
  } else if (!f) {
    leaning = "missing";
  } else {
    leaning = "neutral";
  }
  dot.classList.add(`bon-factor-dot--${leaning}`);

  if (f) {
    const scoreText = typeof f.score === "number" ? f.score.toFixed(2) : "—";
    const confText =
      typeof f.confidence === "number"
        ? `${Math.round(f.confidence * 100)}%`
        : "—";

    dot.setAttribute(
      "aria-label",
      `${fullLabel}: score ${scoreText}, confidence ${confText}`
    );
  } else if (hasRun) {
    dot.setAttribute(
      "aria-label",
      `${fullLabel}: added after this investigation ran — re-run to score`
    );
  } else {
    dot.setAttribute("aria-label", `${fullLabel}: not investigated`);
  }

  const card = buildFactorTooltipCard(fullLabel, f, hasRun, leaning);
  dot.appendChild(card);
  attachFactorCardPositioning(dot, card);

  return dot;
}

export function bonReportsFactorDots(
  investigation: Investigation | null | undefined
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "bon-factors-cell";

  const factorsByKey = new Map<string, FactorWithEvidence>();
  if (Array.isArray(investigation?.factors)) {
    for (const f of investigation.factors) {
      if (f?.key) {
        factorsByKey.set(f.key, f as FactorWithEvidence);
      }
    }
  }

  // Treat "missing" specially only when the investigation actually ran
  // (status done). A never-run investigation gets the plain "missing" dots
  // without the "added after" framing.
  const hasRun = investigation?.status === "done";
  for (const key of BON_FACTOR_KEYS) {
    const f = factorsByKey.get(key);
    wrap.appendChild(buildFactorDot(key, f, hasRun));
  }
  return wrap;
}
