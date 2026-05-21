// Dev-only agent identity: when this build is running from a worktree
// spawned by new-agent.sh, __BON_AGENT__ is the agent slug. Prefix the tab
// title and drop a hash-colored badge into the masthead so it's
// unmistakable which agent's code is loaded. Tree-shakes out for published
// builds — __BON_AGENT__ is null there and the install function bails.

export function bonReportsInstallAgentBadge(): void {
  if (!__BON_AGENT__) {
    return;
  }

  document.title = `[${__BON_AGENT__}] ${document.title}`;

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

  for (const ch of __BON_AGENT__) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }

  const color = palette[Math.abs(hash) % palette.length];

  const badge = document.createElement("span");
  badge.className = "bon-dev-agent-badge";
  badge.textContent = `AGENT · ${__BON_AGENT__.toUpperCase()}`;
  badge.title = `Dev build running from worktree: ${__BON_AGENT__}`;
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
