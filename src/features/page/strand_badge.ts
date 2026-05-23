// Dev builds running from a ../<repo>-strands/<slug>/ worktree get a
// hash-colored badge in the masthead and a [<slug>] tab-title prefix so it
// is unmistakable which strand's code is loaded. Tree-shakes out for
// published builds — __BON_STRAND__ is null and this function bails.

export function bonPageInstallStrandBadge(): void {
  if (!__BON_STRAND__) {
    return;
  }

  document.title = `[${__BON_STRAND__}] ${document.title}`;

  const titlesEl = document.querySelector(".bon-header-titles");
  if (!titlesEl) {
    return;
  }

  const palette = [
    "#d97757",
    "#7ba6d9",
    "#a9b665",
    "#d79921",
    "#b16286",
    "#83a598",
    "#fe8019",
    "#d3869b",
  ];

  let hash = 0;

  for (const ch of __BON_STRAND__) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }

  const color = palette[Math.abs(hash) % palette.length];

  const badge = document.createElement("span");
  badge.className = "bon-dev-strand-badge";
  badge.textContent = `STRAND · ${__BON_STRAND__.toUpperCase()}`;
  badge.title = `Dev build running from worktree: ${__BON_STRAND__}`;
  Object.assign(badge.style, {
    display: "inline-block",
    marginTop: "6px",
    padding: "2px 8px",
    background: color,
    color: "#1a1410",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "10px",
    fontWeight: "600",
    letterSpacing: "0.08em",
    borderRadius: "3px",
  });
  titlesEl.appendChild(badge);
}
