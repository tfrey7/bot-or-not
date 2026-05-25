// Dev builds get a badge in the masthead so it is unmistakable which
// code is loaded. From a ../<repo>-strands/<slug>/ worktree it shows
// "STRAND · <slug>" in a strand-specific color (sourced from the Vibe
// Stranding plugin via .strand.json, or hashed from the slug) plus a
// [<slug>] tab-title prefix. From the main checkout it shows a neutral
// "DEV · MAIN". Tree-shakes out for published builds — import.meta.env.DEV
// is false and this function bails.

const FALLBACK_PALETTE = [
  "#d97757",
  "#7ba6d9",
  "#a9b665",
  "#d79921",
  "#b16286",
  "#83a598",
  "#fe8019",
  "#d3869b",
];

export function pageInstallDevBadge(): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const titlesEl = document.querySelector(".bon-header-titles");
  if (!titlesEl) {
    return;
  }

  if (__STRAND__) {
    document.title = `[${__STRAND__}] ${document.title}`;

    const background = __STRAND_COLOR__ ?? hashedPaletteColor(__STRAND__);

    titlesEl.appendChild(
      buildBadge({
        text: `STRAND · ${__STRAND__.toUpperCase()}`,
        title: `Dev build running from worktree: ${__STRAND__}`,
        background,
        foreground: readableTextOn(background),
      })
    );

    return;
  }

  titlesEl.appendChild(
    buildBadge({
      text: "DEV · MAIN",
      title: "Dev build running from the main checkout",
      background: "#4d4538",
      foreground: "#f5f0e8",
    })
  );
}

interface BadgeOptions {
  text: string;
  title: string;
  background: string;
  foreground: string;
}

function buildBadge(options: BadgeOptions): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "bon-dev-badge";
  badge.textContent = options.text;
  badge.title = options.title;
  Object.assign(badge.style, {
    display: "inline-block",
    marginTop: "6px",
    padding: "2px 8px",
    background: options.background,
    color: options.foreground,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "10px",
    fontWeight: "600",
    letterSpacing: "0.08em",
    borderRadius: "3px",
  });

  return badge;
}

function hashedPaletteColor(slug: string): string {
  let hash = 0;

  for (const ch of slug) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }

  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

// Plugin colors span the whole luminance range (dark navy through bright
// pastel), so the badge can't hard-code a text color. Relative luminance
// per WCAG; threshold 0.5 is good enough for a one-off badge.
function readableTextOn(hex: string): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  return luminance > 0.5 ? "#1a1410" : "#f5f0e8";
}
