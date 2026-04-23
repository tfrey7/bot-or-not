(function () {
  const { version } = browser.runtime.getManifest();
  console.log(`[Bot or Not] v${version} loaded`);

  const ICONS = {
    "not-bot": browser.runtime.getURL("icon-not-bot.svg"),
    bot: browser.runtime.getURL("icon-bot.svg"),
  };

  // --- Report tracking (all Reddit pages) ---

  let pendingReportUsername = null;

  function listenForReports() {
    document.addEventListener(
      "click",
      async function (e) {
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
          const { count } = await browser.runtime.sendMessage({
            type: "report-user",
            username: pendingReportUsername,
          });
          updateBadge(pendingReportUsername, count);
        }
      },
      true // capture phase — fires before Reddit's own handlers
    );
  }

  function updateBadge(reportedUsername, count) {
    const container = document.getElementById("bon-badge-container");
    if (!container || container.dataset.username !== reportedUsername) {
      return;
    }
    const badge = document.getElementById("bon-badge");
    if (badge) {
      badge.src = ICONS.bot;
      badge.alt = "bot";
      badge.title = `${reportedUsername}: bot`;
      badge.className = "bon-badge bon-badge--bot";
    }
    const indicator = document.getElementById("bon-report-count");
    if (indicator) {
      indicator.textContent = count;
      indicator.hidden = false;
    }
  }

  listenForReports();

  // --- Badge injection (profile pages only, SPA-aware) ---

  async function injectBadge() {
    const profileMatch = window.location.pathname.match(
      /^\/(?:user|u)\/([^/?#]+)/i
    );

    // Not on a profile page — remove badge if present
    if (!profileMatch) {
      const existing = document.getElementById("bon-badge-container");
      if (existing) {
        existing.remove();
      }
      return;
    }

    const username = profileMatch[1];

    // Already injected for this user
    const existing = document.getElementById("bon-badge-container");
    if (existing) {
      if (existing.dataset.username === username) {
        return;
      }
      existing.remove();
    }

    const h1 = document.querySelector("h1");
    if (!h1) {
      return;
    }

    const badge = document.createElement("img");
    badge.id = "bon-badge";
    badge.src = ICONS["not-bot"];
    badge.alt = "not-bot";
    badge.title = `${username}: not a bot`;
    badge.className = "bon-badge bon-badge--not-bot";

    const reportCount = document.createElement("span");
    reportCount.id = "bon-report-count";
    reportCount.className = "bon-report-count";
    reportCount.hidden = true;

    // Fetch initial state from background
    const { count, isBot } = await browser.runtime.sendMessage({
      type: "get-user-state",
      username,
    });
    if (isBot) {
      badge.src = ICONS.bot;
      badge.title = `${username}: bot`;
      badge.className = "bon-badge bon-badge--bot";
      badge.alt = "bot";
      reportCount.textContent = count;
      reportCount.hidden = false;
    }

    const checkBtn = document.createElement("button");
    checkBtn.id = "bon-check-btn";
    checkBtn.className = "bon-check-btn";
    checkBtn.title = `Check Bot Bouncer for ${username}`;
    checkBtn.textContent = "🔍";

    checkBtn.addEventListener("click", () => {
      browser.runtime.sendMessage({
        type: "open-tabs",
        urls: [
          `https://www.reddit.com/r/BotBouncer/search/?q=${encodeURIComponent(username)}&restrict_sr=true`,
          `https://redditmetis.com/user/${encodeURIComponent(username)}`,
          `https://profileprobe.com/botornot/?u=${encodeURIComponent(username)}`,
        ],
      });
    });

    const badgeWrapper = document.createElement("span");
    badgeWrapper.className = "bon-badge-wrapper";
    badgeWrapper.appendChild(badge);
    badgeWrapper.appendChild(reportCount);

    const container = document.createElement("div");
    container.id = "bon-badge-container";
    container.dataset.username = username;
    container.appendChild(badgeWrapper);
    container.appendChild(checkBtn);
    h1.appendChild(container);
  }

  injectBadge();

  // Keep observer running permanently to handle SPA navigation
  const observer = new MutationObserver(() => {
    injectBadge();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
