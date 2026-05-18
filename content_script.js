(function () {
  const { version } = browser.runtime.getManifest();
  console.log(`[Bot or Not] v${version} loaded`);

  const ICONS = {
    "not-bot": browser.runtime.getURL("icon-not-bot.svg"),
    bot: browser.runtime.getURL("icon-bot.svg"),
  };

  // --- Report tracking (all Reddit pages) ---

  let pendingReport = null;

  function buildReportContext(e) {
    const authorEl = e
      .composedPath()
      .find(
        (el) =>
          el.tagName &&
          (el.tagName.toLowerCase() === "shreddit-post" ||
            el.tagName.toLowerCase() === "shreddit-comment") &&
          el.getAttribute("author")
      );
    if (!authorEl) return null;

    const username = authorEl.getAttribute("author");
    if (!username) return null;

    const tag = authorEl.tagName.toLowerCase();
    const context = {
      kind: tag === "shreddit-post" ? "post" : "comment",
      permalink: authorEl.getAttribute("permalink") || null,
      subreddit:
        authorEl.getAttribute("subreddit-prefixed-name") ||
        authorEl.getAttribute("subreddit-name") ||
        null,
    };
    if (tag === "shreddit-post") {
      context.postTitle = authorEl.getAttribute("post-title") || null;
      context.postId = authorEl.id || null;
    } else {
      context.commentId =
        authorEl.getAttribute("thingid") ||
        authorEl.getAttribute("comment-id") ||
        authorEl.id ||
        null;
    }
    return { username, context };
  }

  function listenForReports() {
    document.addEventListener(
      "click",
      async function (e) {
        // Cache report context from the "..." click on a post/comment.
        // Reddit's subsequent report-dialog clicks happen outside the post
        // element, so this initial capture is our only chance.
        const cached = buildReportContext(e);
        if (cached) pendingReport = cached;

        const reportSpan = e
          .composedPath()
          .find(
            (el) =>
              el.classList &&
              el.classList.contains("report-button-content") &&
              el.textContent.trim() === "Submit"
          );
        if (reportSpan && pendingReport) {
          const { username, context } = pendingReport;
          const { count } = await browser.runtime.sendMessage({
            type: "report-user",
            username,
            context,
          });
          knownBots.add(username);
          updateBadge(username, count);
          markUser(username);
          pendingReport = null;
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

  // --- Inline bot indicators (all Reddit pages) ---

  let knownBots = new Set();
  let botsLoaded = false;

  async function loadKnownBots() {
    const { bots } = await browser.runtime.sendMessage({
      type: "get-known-bots",
    });
    knownBots = new Set(bots);
    botsLoaded = true;
    markBots();
  }

  function markBots() {
    if (!botsLoaded) {
      return;
    }
    document
      .querySelectorAll(
        'a[href*="/user/"]:not([data-bon-marked]), a[href*="/u/"]:not([data-bon-marked])'
      )
      .forEach((el) => {
        const href = el.getAttribute("href");
        const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
        if (!match) {
          return;
        }
        if (el.closest('[id^="profile-tab"]')) {
          return;
        }
        el.dataset.bonMarked = "true";
        const username = match[1];
        if (!knownBots.has(username)) {
          return;
        }
        const icon = document.createElement("img");
        icon.src = ICONS.bot;
        icon.className = "bon-inline-bot-icon";
        icon.title = `${username}: bot`;
        icon.alt = "bot";
        el.appendChild(icon);
      });
  }

  function markUser(username) {
    document
      .querySelectorAll('a[href*="/user/"], a[href*="/u/"]')
      .forEach((el) => {
        const href = el.getAttribute("href");
        const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
        if (!match || match[1] !== username) {
          return;
        }
        if (el.closest('[id^="profile-tab"]')) {
          return;
        }
        if (el.querySelector(".bon-inline-bot-icon")) {
          return;
        }
        el.dataset.bonMarked = "true";
        const icon = document.createElement("img");
        icon.src = ICONS.bot;
        icon.className = "bon-inline-bot-icon";
        icon.title = `${username}: bot`;
        icon.alt = "bot";
        el.appendChild(icon);
      });
  }

  loadKnownBots();

  document.addEventListener(
    "click",
    (e) => {
      const icon = e.target?.closest?.(".bon-inline-bot-icon");
      if (!icon) return;
      e.preventDefault();
      e.stopPropagation();
      browser.runtime.sendMessage({ type: "open-popup" });
    },
    true
  );

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

    // Fetch initial state after container is in DOM to prevent race condition
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
  }

  injectBadge();

  // --- Passive ban/deletion detection ---

  // Track what we've already reported per page-load to avoid spam
  let lastUserStatusReported = null;
  const reportedPostPermalinks = new Set();

  function detectUserStatus() {
    const profileMatch = window.location.pathname.match(
      /^\/(?:user|u)\/([^/?#]+)/i
    );
    if (!profileMatch) return;
    const username = profileMatch[1];
    const bodyText = document.body?.textContent || "";

    let status = null;
    if (/account has been suspended/i.test(bodyText)) {
      status = "suspended";
    } else if (/nobody on Reddit goes by that name/i.test(bodyText)) {
      status = "deleted";
    }

    if (!status) return;
    const key = `${username}#${status}`;
    if (lastUserStatusReported === key) return;
    lastUserStatusReported = key;
    browser.runtime.sendMessage({
      type: "update-user-status",
      username,
      status,
    });
  }

  function reportPostStatus(permalink, status) {
    if (!permalink || !status) return;
    if (reportedPostPermalinks.has(permalink)) return;
    reportedPostPermalinks.add(permalink);
    console.log("[Bot or Not] post status detected", { permalink, status });
    browser.runtime.sendMessage({
      type: "update-post-status",
      permalink,
      status,
    });
  }

  function detectPostStatuses() {
    document.querySelectorAll("shreddit-post").forEach((post) => {
      const permalink = post.getAttribute("permalink");
      if (!permalink) return;
      const removedBy = post.getAttribute("removed-by-category");
      const author = post.getAttribute("author");
      let status = null;
      if (removedBy && removedBy !== "" && removedBy !== "none") {
        status = "removed";
      } else if (author === "[deleted]") {
        status = "deleted";
      }
      if (status) reportPostStatus(permalink, status);
    });
  }

  function detectStandalonePostStatus() {
    const m = window.location.pathname.match(
      /^(\/r\/[^/]+\/comments\/[^/]+\/[^/?#]+\/?)/i
    );
    if (!m) return;
    const permalink = m[1].endsWith("/") ? m[1] : `${m[1]}/`;
    const bodyText = document.body?.textContent || "";
    let status = null;
    if (/removed by the moderators of/i.test(bodyText)) {
      status = "removed";
    } else if (
      /Sorry, this post (was|has been) deleted by the (person|user) who originally posted it/i.test(
        bodyText
      )
    ) {
      status = "deleted";
    }
    if (status) reportPostStatus(permalink, status);
  }

  function runStatusDetection() {
    detectUserStatus();
    detectPostStatuses();
    detectStandalonePostStatus();
  }

  runStatusDetection();

  // Reset detection state on SPA navigation
  let lastUrl = window.location.href;
  function maybeResetForNavigation() {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    lastUserStatusReported = null;
    reportedPostPermalinks.clear();
    pendingReport = null;
  }

  // Keep observer running permanently to handle SPA navigation and dynamic content
  const observer = new MutationObserver(() => {
    maybeResetForNavigation();
    injectBadge();
    markBots();
    runStatusDetection();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
