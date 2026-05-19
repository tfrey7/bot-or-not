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
  dotElement: HTMLElement,
  cardElement: HTMLElement
): void {
  let mounted = false;

  const show = (): void => {
    if (!mounted) {
      document.body.appendChild(cardElement);
      mounted = true;
    }

    const dotRect = dotElement.getBoundingClientRect();
    const cardWidth = cardElement.offsetWidth;
    const cardHeight = cardElement.offsetHeight;
    if (!cardWidth || !cardHeight) {
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const gap = 10;

    let left = dotRect.left + dotRect.width / 2 - cardWidth / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - margin - cardWidth));

    let top = dotRect.top - cardHeight - gap;
    if (top < margin) {
      top = dotRect.bottom + gap;
    }

    top = Math.max(margin, Math.min(top, viewportHeight - margin - cardHeight));

    cardElement.style.left = `${left}px`;
    cardElement.style.top = `${top}px`;
    cardElement.classList.add("bon-factor-card--visible");
  };

  const hide = (): void => {
    cardElement.classList.remove("bon-factor-card--visible");
  };

  dotElement.addEventListener("mouseenter", show);
  dotElement.addEventListener("mouseleave", hide);
  dotElement.addEventListener("focus", show);
  dotElement.addEventListener("blur", hide);
}

function buildFactorTooltipCard(
  fullLabel: string,
  factor: FactorWithEvidence | undefined,
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

  if (factor && typeof factor.score === "number") {
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

  if (factor && typeof factor.score === "number") {
    card.appendChild(bonReportsScoreBar(factor.score, factor.confidence));
  }

  if (factor && typeof factor.confidence === "number") {
    const confidence = document.createElement("span");
    confidence.className = "bon-factor-card-confidence";
    confidence.textContent = `${Math.round(factor.confidence * 100)}% confidence`;
    card.appendChild(confidence);
  }

  if (factor?.reasoning) {
    const reasoning = document.createElement("span");
    reasoning.className = "bon-factor-card-reasoning";
    reasoning.textContent = factor.reasoning;
    card.appendChild(reasoning);
  } else if (!factor && hasRun) {
    const reasoning = document.createElement("span");
    reasoning.className =
      "bon-factor-card-reasoning bon-factor-card-reasoning--muted";
    reasoning.textContent =
      "Added after this investigation ran — re-run to score.";
    card.appendChild(reasoning);
  } else if (!factor) {
    const reasoning = document.createElement("span");
    reasoning.className =
      "bon-factor-card-reasoning bon-factor-card-reasoning--muted";
    reasoning.textContent = "Not investigated.";
    card.appendChild(reasoning);
  }

  if (factor && Array.isArray(factor.evidence) && factor.evidence.length) {
    const list = document.createElement("ul");
    list.className = "bon-factor-card-evidence";

    for (const cite of factor.evidence) {
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
  factor: FactorWithEvidence | undefined,
  hasRun: boolean
): HTMLSpanElement {
  const fullLabel = BON_FACTOR_LABELS[key] || key;

  const dot = document.createElement("span");
  dot.className = "bon-factor-dot";
  dot.tabIndex = 0;

  let leaning: DotLeaning;
  if (factor && typeof factor.score === "number") {
    leaning = bonScoreLeaning(factor.score, factor.confidence) as DotLeaning;
  } else if (!factor && hasRun) {
    leaning = "new";
  } else if (!factor) {
    leaning = "missing";
  } else {
    leaning = "neutral";
  }

  dot.classList.add(`bon-factor-dot--${leaning}`);

  if (factor) {
    const scoreText =
      typeof factor.score === "number" ? factor.score.toFixed(2) : "—";
    const confidenceText =
      typeof factor.confidence === "number"
        ? `${Math.round(factor.confidence * 100)}%`
        : "—";

    dot.setAttribute(
      "aria-label",
      `${fullLabel}: score ${scoreText}, confidence ${confidenceText}`
    );
  } else if (hasRun) {
    dot.setAttribute(
      "aria-label",
      `${fullLabel}: added after this investigation ran — re-run to score`
    );
  } else {
    dot.setAttribute("aria-label", `${fullLabel}: not investigated`);
  }

  const card = buildFactorTooltipCard(fullLabel, factor, hasRun, leaning);
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

  for (const factor of investigation?.factors ?? []) {
    if (factor?.key) {
      factorsByKey.set(factor.key, factor as FactorWithEvidence);
    }
  }

  // Treat "missing" specially only when the investigation actually ran
  // (status done). A never-run investigation gets the plain "missing" dots
  // without the "added after" framing.
  const hasRun = investigation?.status === "done";

  for (const key of BON_FACTOR_KEYS) {
    const factor = factorsByKey.get(key);
    wrap.appendChild(buildFactorDot(key, factor, hasRun));
  }

  return wrap;
}
