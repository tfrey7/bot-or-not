// The horizontal strip of factor dots in the always-visible preview, each
// dot a glanceable signal-strength indicator. Hovering or focusing a dot
// reveals a tooltip card with the factor's full reasoning and evidence.

import { BON_FACTOR_KEYS, BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor, Investigation } from "../../types.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";

interface FactorWithExtras extends Factor {
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

function buildFactorDotCard(
  fullLabel: string,
  factor: FactorWithExtras | undefined,
  hasRun: boolean,
  leaning: DotLeaning
): HTMLSpanElement {
  const card = document.createElement("span");
  // The leaning modifier carries the --bon-panel-factor-accent custom
  // property forward when the card is hoisted to document.body for
  // positioning — at that point inheritance from the dot is severed.
  card.className = `bon-panel-factor-card bon-panel-factor-card--${leaning}`;
  card.setAttribute("role", "tooltip");

  const header = document.createElement("span");
  header.className = "bon-panel-factor-card__header";

  const name = document.createElement("span");
  name.className = "bon-panel-factor-card__name";
  name.textContent = fullLabel;
  header.appendChild(name);

  if (factor && typeof factor.score === "number") {
    const pill = document.createElement("span");
    pill.className = `bon-panel-factor-card__signal bon-panel-factor-card__signal--${leaning}`;

    pill.textContent =
      leaning === "neutral" ? "Neutral" : bonFormatVerdict(leaning);

    header.appendChild(pill);
  }

  card.appendChild(header);

  if (factor && typeof factor.confidence === "number") {
    const confidence = document.createElement("span");
    confidence.className = "bon-panel-factor-card__confidence";
    confidence.textContent = `${Math.round(factor.confidence * 100)}% confidence`;
    card.appendChild(confidence);
  }

  if (factor?.reasoning) {
    const reasoning = document.createElement("span");
    reasoning.className = "bon-panel-factor-card__reasoning";
    reasoning.textContent = factor.reasoning;
    card.appendChild(reasoning);
  } else if (!factor && hasRun) {
    const reasoning = document.createElement("span");
    reasoning.className =
      "bon-panel-factor-card__reasoning bon-panel-factor-card__reasoning--muted";
    reasoning.textContent =
      "Added after this investigation ran — re-run to score.";
    card.appendChild(reasoning);
  } else if (!factor) {
    const reasoning = document.createElement("span");
    reasoning.className =
      "bon-panel-factor-card__reasoning bon-panel-factor-card__reasoning--muted";
    reasoning.textContent = "Not investigated.";
    card.appendChild(reasoning);
  }

  if (factor && Array.isArray(factor.evidence) && factor.evidence.length) {
    const list = document.createElement("ul");
    list.className = "bon-panel-factor-card__evidence";

    for (const cite of factor.evidence) {
      const item = document.createElement("li");
      item.textContent = cite;
      list.appendChild(item);
    }

    card.appendChild(list);
  }

  return card;
}

// position: fixed alone isn't enough: any transform/filter on an ancestor
// (Reddit's chrome is full of them) re-roots the fixed-position containing
// block to that ancestor, breaking viewport coordinates. So on first hover
// we move the card out of the dot and into document.body — guaranteed to
// sit under <html>, so fixed positioning lands in true viewport space.
// Show/hide is then class-toggled (the CSS :hover rule wouldn't fire on a
// card that's no longer a descendant of the dot).
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
    cardElement.classList.add("bon-panel-factor-card--visible");
  };

  const hide = (): void => {
    cardElement.classList.remove("bon-panel-factor-card--visible");
  };

  dotElement.addEventListener("mouseenter", show);
  dotElement.addEventListener("mouseleave", hide);
  dotElement.addEventListener("focus", show);
  dotElement.addEventListener("blur", hide);
}

function buildFactorDot(
  key: string,
  factor: FactorWithExtras | undefined,
  hasRun: boolean
): HTMLSpanElement {
  const fullLabel = BON_FACTOR_LABELS[key] || key;

  const dot = document.createElement("span");
  dot.className = "bon-panel-factor-dot";
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

  dot.classList.add(`bon-panel-factor-dot--${leaning}`);

  if (factor) {
    const confidenceText =
      typeof factor.confidence === "number"
        ? `${Math.round(factor.confidence * 100)}%`
        : "—";

    dot.setAttribute(
      "aria-label",
      `${fullLabel}: ${leaning === "neutral" ? "neutral" : bonFormatVerdict(leaning)} · ${confidenceText} confidence`
    );
  } else if (hasRun) {
    dot.setAttribute(
      "aria-label",
      `${fullLabel}: added after this investigation ran — re-run to score`
    );
  } else {
    dot.setAttribute("aria-label", `${fullLabel}: not investigated`);
  }

  const card = buildFactorDotCard(fullLabel, factor, hasRun, leaning);
  dot.appendChild(card);
  attachFactorCardPositioning(dot, card);
  return dot;
}

export function bonPanelBuildFactorDots(
  investigation: Investigation | null | undefined
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-panel-factor-dots";

  const byKey = new Map<string, FactorWithExtras>();
  if (Array.isArray(investigation?.factors)) {
    for (const factor of investigation.factors) {
      if (factor?.key) {
        byKey.set(factor.key, factor as FactorWithExtras);
      }
    }
  }

  const hasRun = investigation?.status === "done";
  for (const key of BON_FACTOR_KEYS) {
    wrap.appendChild(buildFactorDot(key, byKey.get(key), hasRun));
  }

  return wrap;
}
