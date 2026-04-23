(function () {
  const { version } = browser.runtime.getManifest();
  console.log(`[Bot or Not] v${version} loaded`);

  // --- Report tracking (all Reddit pages) ---

  function listenForReports() {
    document.addEventListener(
      "click",
      function (e) {
        const btn = e.target.closest(".report-button-content button");
        if (btn && btn.textContent.trim().toLowerCase() === "submit") {
          console.log("[Bot or Not] Reported");
        }
      },
      true // capture phase — fires before Reddit's own handlers
    );
  }

  listenForReports();

  // --- Badge injection (profile pages only) ---

  const profileMatch = window.location.pathname.match(
    /^\/(?:user|u)\/([^/?#]+)/i
  );
  if (!profileMatch) {
    return;
  }

  const username = profileMatch[1];
  const STATES = {
    "not-bot": {
      icon: browser.runtime.getURL("icon-not-bot.svg"),
      title: `${username}: not a bot — click to mark as bot`,
      next: "bot",
    },
    bot: {
      icon: browser.runtime.getURL("icon-bot.svg"),
      title: `${username}: bot — click to mark as not a bot`,
      next: "not-bot",
    },
  };

  function injectBadge() {
    if (document.getElementById("bon-badge-container")) {
      return;
    }

    const h1 = document.querySelector("h1");
    if (!h1) {
      return;
    }

    let state = "not-bot";

    const badge = document.createElement("img");
    badge.id = "bon-badge";
    badge.className = `bon-badge bon-badge--${state}`;
    badge.src = STATES[state].icon;
    badge.alt = state;
    badge.title = STATES[state].title;

    function applyState(newState) {
      state = newState;
      badge.src = STATES[state].icon;
      badge.alt = state;
      badge.title = STATES[state].title;
      badge.className = `bon-badge bon-badge--${state}`;
    }

    // Restore saved state
    browser.storage.local.get("bots").then(({ bots = [] }) => {
      if (bots.includes(username)) {
        applyState("bot");
      }
    });

    badge.addEventListener("click", () => {
      applyState(STATES[state].next);
      browser.storage.local.get("bots").then(({ bots = [] }) => {
        const updated =
          state === "bot"
            ? [...new Set([...bots, username])]
            : bots.filter((b) => b !== username);
        browser.storage.local.set({ bots: updated });
      });
    });

    const checkBtn = document.createElement("button");
    checkBtn.id = "bon-check-btn";
    checkBtn.className = "bon-check-btn";
    checkBtn.title = `Check Bot Bouncer for ${username}`;
    checkBtn.textContent = "🔍";

    checkBtn.addEventListener("click", () => {
      const url = `https://www.reddit.com/r/BotBouncer/search/?q=${encodeURIComponent(username)}&restrict_sr=true`;
      browser.tabs.create({ url });
    });

    const container = document.createElement("div");
    container.id = "bon-badge-container";
    container.appendChild(badge);
    container.appendChild(checkBtn);
    h1.appendChild(container);
  }

  injectBadge();

  // New Reddit is a SPA — the h1 may not exist yet on initial load
  const observer = new MutationObserver(() => {
    injectBadge();
    if (document.getElementById("bon-badge-container")) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
