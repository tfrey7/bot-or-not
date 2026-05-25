// Runs the persona label's "slow reveal + glow" using the Web Animations
// API. We drive this from JS (rather than CSS animation-delay) so the
// behavior is identical across surfaces — the inline-tag flyout and the
// embedded profile panel both live inside Reddit's style cascade, which
// can quietly suppress class-driven keyframes; WAAPI animations override
// inline styles directly and don't depend on selector specificity.

const DEFAULT_REVEAL_DURATION_MS = 1000;

export function revealPersonaLabel(
  label: HTMLElement,
  durationMs: number = DEFAULT_REVEAL_DURATION_MS
): void {
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || typeof label.animate !== "function") {
    label.style.removeProperty("opacity");
    label.style.removeProperty("transform");
    label.style.removeProperty("text-shadow");
    return;
  }

  const glow =
    "0 0 14px var(--bon-persona-accent), 0 0 4px var(--bon-persona-accent)";

  const anim = label.animate(
    [
      { opacity: 0, transform: "translateY(2px)", textShadow: "none" },
      {
        opacity: 1,
        transform: "translateY(0)",
        textShadow: glow,
        offset: 0.55,
      },
      { opacity: 1, transform: "translateY(0)", textShadow: "none" },
    ],
    { duration: durationMs, easing: "ease-out", fill: "both" }
  );

  anim.addEventListener("finish", () => {
    label.style.removeProperty("opacity");
    label.style.removeProperty("transform");
    label.style.removeProperty("text-shadow");
  });
}

// Sets the initial hidden state inline so the label is invisible the
// instant it's appended, before any animation kicks off.
export function hidePersonaLabel(label: HTMLElement): void {
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion) {
    return;
  }

  label.style.opacity = "0";
  label.style.transform = "translateY(2px)";
}
