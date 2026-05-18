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
  f: FactorWithExtras | undefined,
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

  if (f && typeof f.score === "number") {
    const pill = document.createElement("span");
    pill.className = `bon-panel-factor-card__signal bon-panel-factor-card__signal--${leaning}`;
    pill.textContent =
      leaning === "neutral" ? "Neutral" : bonFormatVerdict(leaning);
    header.appendChild(pill);
  }
  card.appendChild(header);

  if (f && typeof f.confidence === "number") {
    const conf = document.createElement("span");
    conf.className = "bon-panel-factor-card__confidence";
    conf.textContent = `${Math.round(f.confidence * 100)}% confidence`;
    card.appendChild(conf);
  }

  if (f?.reasoning) {
    const r = document.createElement("span");
    r.className = "bon-panel-factor-card__reasoning";
    r.textContent = f.reasoning;
    card.appendChild(r);
  } else if (!f && hasRun) {
    const r = document.createElement("span");
    r.className =
      "bon-panel-factor-card__reasoning bon-panel-factor-card__reasoning--muted";
    r.textContent = "Added after this investigation ran — re-run to score.";
    card.appendChild(r);
  } else if (!f) {
    const r = document.createElement("span");
    r.className =
      "bon-panel-factor-card__reasoning bon-panel-factor-card__reasoning--muted";
    r.textContent = "Not investigated.";
    card.appendChild(r);
  }

  if (f && Array.isArray(f.evidence) && f.evidence.length) {
    const list = document.createElement("ul");
    list.className = "bon-panel-factor-card__evidence";
    for (const cite of f.evidence) {
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
    cardEl.classList.add("bon-panel-factor-card--visible");
  };
  const hide = (): void => {
    cardEl.classList.remove("bon-panel-factor-card--visible");
  };
  dotEl.addEventListener("mouseenter", show);
  dotEl.addEventListener("mouseleave", hide);
  dotEl.addEventListener("focus", show);
  dotEl.addEventListener("blur", hide);
}

function buildFactorDot(
  key: string,
  f: FactorWithExtras | undefined,
  hasRun: boolean
): HTMLSpanElement {
  const fullLabel = BON_FACTOR_LABELS[key] || key;

  const dot = document.createElement("span");
  dot.className = "bon-panel-factor-dot";
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
  dot.classList.add(`bon-panel-factor-dot--${leaning}`);

  if (f) {
    const confText =
      typeof f.confidence === "number"
        ? `${Math.round(f.confidence * 100)}%`
        : "—";
    dot.setAttribute(
      "aria-label",
      `${fullLabel}: ${leaning === "neutral" ? "neutral" : bonFormatVerdict(leaning)} · ${confText} confidence`
    );
  } else if (hasRun) {
    dot.setAttribute(
      "aria-label",
      `${fullLabel}: added after this investigation ran — re-run to score`
    );
  } else {
    dot.setAttribute("aria-label", `${fullLabel}: not investigated`);
  }

  const card = buildFactorDotCard(fullLabel, f, hasRun, leaning);
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
    for (const f of investigation.factors) {
      if (f?.key) {
        byKey.set(f.key, f as FactorWithExtras);
      }
    }
  }
  const hasRun = investigation?.status === "done";
  for (const key of BON_FACTOR_KEYS) {
    wrap.appendChild(buildFactorDot(key, byKey.get(key), hasRun));
  }
  return wrap;
}
