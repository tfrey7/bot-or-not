(function () {
  const { version } = browser.runtime.getManifest();
  console.log(`[Bot or Not] v${version} loaded`);

  // --- Report tracking (all Reddit pages) ---

  let pendingReportUsername = null;

  function listenForReports() {
    document.addEventListener(
      "click",
      function (e) {
        // Cache the username from the nearest faceplate-tracker on every click,
        // so we have it ready if the user proceeds to submit a report
        const profileMatch = window.location.pathname.match(
          /^\/(?:user|u)\/([^/?#]+)/i
        );
        if (profileMatch) {
          pendingReportUsername = profileMatch[1];
        } else {
          const tracker = e
            .composedPath()
            .find(
              (el) =>
                el.tagName && el.tagName.toLowerCase() === "faceplate-tracker"
            );
          if (tracker) {
            const authorEl = tracker.querySelector(".author-name");
            if (authorEl) {
              pendingReportUsername = authorEl.textContent.trim();
            }
          }
        }

        const reportSpan = e
          .composedPath()
          .find(
            (el) =>
              el.classList &&
              el.classList.contains("report-button-content") &&
              el.textContent.trim() === "Submit"
          );
        if (reportSpan && pendingReportUsername) {
          browser.storage.local.get("reports").then(({ reports = {} }) => {
            reports[pendingReportUsername] =
              (reports[pendingReportUsername] || 0) + 1;
            browser.storage.local.set({ reports });
            updateReportIndicator(
              pendingReportUsername,
              reports[pendingReportUsername]
            );
          });
        }
      },
      true // capture phase — fires before Reddit's own handlers
    );
  }

  function updateReportIndicator(reportedUsername, count) {
    const indicator = document.getElementById("bon-report-count");
    if (indicator && reportedUsername === username) {
      indicator.textContent = count;
      indicator.hidden = false;
    }
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
      [
        `https://www.reddit.com/r/BotBouncer/search/?q=${encodeURIComponent(username)}&restrict_sr=true`,
        `https://redditmetis.com/user/${encodeURIComponent(username)}`,
        `https://profileprobe.com/botornot/?u=${encodeURIComponent(username)}`,
      ].forEach((url) => {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      });
    });

    const reportCount = document.createElement("span");
    reportCount.id = "bon-report-count";
    reportCount.className = "bon-report-count";
    reportCount.hidden = true;

    // Restore report count
    browser.storage.local.get("reports").then(({ reports = {} }) => {
      const count = reports[username];
      if (count) {
        reportCount.textContent = count;
        reportCount.hidden = false;
      }
    });

    const badgeWrapper = document.createElement("span");
    badgeWrapper.className = "bon-badge-wrapper";
    badgeWrapper.appendChild(badge);
    badgeWrapper.appendChild(reportCount);

    const container = document.createElement("div");
    container.id = "bon-badge-container";
    container.appendChild(badgeWrapper);
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
