// Horizontal score-strength bar rendered under a factor's name in both
// the row's factor-dot hover card and the expanded investigation detail.
// The fill colour follows the factor's bot↔human leaning; the fill width
// follows confidence so a low-confidence factor reads as a narrower bar
// even when the score is decisive.

import { bonScoreLeaning } from "../../utils/scoring.ts";

export function bonRedditorsScoreBar(
  score: number,
  confidence: number | null | undefined
): HTMLDivElement {
  const clamped = Math.max(-1, Math.min(1, score));

  const clampedConfidence =
    typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0;

  const bar = document.createElement("div");
  bar.className = "bon-factor-bar";

  const fill = document.createElement("div");
  const leaning = bonScoreLeaning(clamped, confidence);

  const fillClass =
    leaning === "likely-bot"
      ? "bot"
      : leaning === "likely-human"
        ? "human"
        : leaning;

  fill.className = `bon-factor-bar-fill bon-factor-bar-fill--${fillClass}`;
  fill.style.left = "0";
  fill.style.width = `${clampedConfidence * 100}%`;

  bar.appendChild(fill);
  return bar;
}
