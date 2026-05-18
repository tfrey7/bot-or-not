(function () {
  const { version } = browser.runtime.getManifest();
  console.log(`[Bot or Not] v${version} loaded`);

  const ICONS = {
    bot: browser.runtime.getURL("icons/icon-bot.png"),
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
          await browser.runtime.sendMessage({
            type: "report-user",
            username,
            context,
          });
          knownBots.add(username);
          markUser(username);
          pendingReport = null;
        }
      },
      true // capture phase — fires before Reddit's own handlers
    );
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

  // --- Profile panel injection (profile pages only, SPA-aware) ---

  const FACTOR_LABELS = {
    account_age_vs_activity: "Account age vs activity",
    karma_farming_subs: "Karma-farming subreddits",
    fake_political_subs: "Fake political subreddits",
    llm_content_style: "LLM-generated content style",
    timestamp_patterns: "Posting timestamp patterns",
    topical_drift: "Topical drift / inconsistency",
    engagement_patterns: "Engagement patterns",
    username_pattern: "Username pattern",
    bot_bouncer_status: "Bot Bouncer status",
  };

  const FACTOR_ORDER = Object.keys(FACTOR_LABELS);

  // Cache last-known report per user so MutationObserver-driven re-inserts
  // can render synchronously instead of waiting on a round-trip to the
  // background page.
  const reportCache = new Map();

  function ensureProfilePanel(username) {
    if (document.getElementById("bon-profile-panel")) return;
    if (reportCache.has(username)) {
      renderProfilePanel(username, reportCache.get(username));
    } else {
      refreshProfilePanel(username);
    }
  }

  function injectPanel() {
    const profileMatch = window.location.pathname.match(
      /^\/(?:user|u)\/([^/?#]+)/i
    );

    // Not on a profile page — remove panel if present
    if (!profileMatch) {
      const existingPanel = document.getElementById("bon-profile-panel");
      if (existingPanel) existingPanel.remove();
      return;
    }

    const username = profileMatch[1];

    const existingPanel = document.getElementById("bon-profile-panel");
    if (existingPanel) {
      if (existingPanel.dataset.username === username) return;
      existingPanel.remove();
    }

    const h1 = document.querySelector("h1");
    if (!h1) return;

    ensureProfilePanel(username);
  }

  async function refreshProfilePanel(username) {
    const profileMatch = window.location.pathname.match(
      /^\/(?:user|u)\/([^/?#]+)/i
    );
    if (!profileMatch || profileMatch[1] !== username) return;
    let report = null;
    try {
      const res = await browser.runtime.sendMessage({
        type: "get-user-report",
        username,
      });
      report = res?.report ?? null;
      reportCache.set(username, report);
    } catch (err) {
      console.error("[Bot or Not] failed to fetch user report", err);
    }
    renderProfilePanel(username, report);
    if (report && !report.createdAt) {
      fetchAndStoreCakeDay(username);
    }
  }

  function renderProfilePanel(username, report) {
    const h1 = document.querySelector("h1");
    if (!h1) return;

    const existing = document.getElementById("bon-profile-panel");
    const wasExpanded =
      existing?.querySelector(".bon-profile-panel__body")?.hidden === false;

    const fresh = buildProfilePanel(username, report, {
      expanded: wasExpanded,
    });
    if (existing) {
      existing.replaceWith(fresh);
      return;
    }

    // Reddit's new profile UI wraps the header row (avatar + text column) in
    // a passthrough <div class="min-w-0 max-w-full overflow-x-clip"> whose
    // only child is that row. Appending here puts the panel directly below
    // the header at full container width, and the wrapper sits *above* the
    // reconciled tab/content area that wipes appended siblings. Falls back
    // to inside <h1> (verified stable) when the wrapper isn't found.
    const headerWrapper = h1.closest("div.min-w-0.max-w-full.overflow-x-clip");
    if (headerWrapper) {
      headerWrapper.appendChild(fresh);
      return;
    }
    h1.appendChild(fresh);
  }

  function buildProfilePanel(username, report, { expanded = false } = {}) {
    const panel = document.createElement("div");
    panel.id = "bon-profile-panel";
    panel.className = "bon-profile-panel";
    panel.dataset.username = username;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "bon-profile-panel__header";
    header.setAttribute("aria-expanded", String(expanded));

    const title = document.createElement("span");
    title.className = "bon-profile-panel__title";
    title.textContent = "Bot or Not";
    header.appendChild(title);

    const stats = document.createElement("span");
    stats.className = "bon-profile-panel__stats";
    appendStatPills(stats, report);
    header.appendChild(stats);

    const chevron = document.createElement("span");
    chevron.className = "bon-profile-panel__chevron";
    chevron.textContent = "▼";
    header.appendChild(chevron);

    const body = document.createElement("div");
    body.className = "bon-profile-panel__body";
    body.hidden = !expanded;
    body.appendChild(buildInvestigationSection(username, report));
    body.appendChild(buildReportsSection(report));

    header.addEventListener("click", () => {
      const isExpanded = header.getAttribute("aria-expanded") === "true";
      const next = !isExpanded;
      header.setAttribute("aria-expanded", String(next));
      body.hidden = !next;
    });

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }

  function appendStatPills(container, report) {
    const verdictPill = buildVerdictPill(report?.investigation);
    if (verdictPill) container.appendChild(verdictPill);
  }

  function buildVerdictPill(investigation) {
    if (!investigation) return null;
    const span = document.createElement("span");
    if (investigation.status === "running") {
      const stale = bonIsInvestigationStale(investigation);
      span.className = `bon-stat-pill bon-stat-pill--verdict-${stale ? "error" : "running"}`;
      span.textContent = stale ? "🤖 stalled" : "🤖 investigating…";
      span.title = stale
        ? "AI investigation appears orphaned — click investigate to retry"
        : "AI investigation in progress";
      return span;
    }
    if (investigation.status === "error") {
      span.className = "bon-stat-pill bon-stat-pill--verdict-error";
      span.textContent = "🤖 error";
      span.title = investigation.error || "Investigation failed";
      return span;
    }
    const norm = bonNormalizeInvestigation(investigation);
    if (!norm.verdict) return null;
    span.className = `bon-stat-pill bon-stat-pill--verdict-${norm.verdict}`;
    span.textContent = `🤖 ${norm.verdict.replace(/-/g, " ")}`;
    if (typeof norm.confidence === "number") {
      const conf = document.createElement("span");
      conf.className = "bon-stat-pill__conf";
      conf.textContent = `${Math.round(norm.confidence * 100)}%`;
      span.appendChild(conf);
    }
    span.title = norm.summary || norm.verdict;
    return span;
  }

  function buildInvestigationSection(username, report) {
    const investigation = bonNormalizeInvestigation(report?.investigation);
    const section = document.createElement("div");
    section.className = "bon-panel-section";

    const title = document.createElement("p");
    title.className = "bon-panel-section__title";
    const label = document.createElement("span");
    label.textContent = "AI investigation";
    title.appendChild(label);

    const actions = document.createElement("span");
    actions.className = "bon-panel-actions";
    actions.appendChild(buildInvestigateBtn(username, investigation));
    actions.appendChild(buildExternalCheckBtn(username));
    title.appendChild(actions);

    section.appendChild(title);

    if (!investigation) {
      const empty = document.createElement("p");
      empty.className = "bon-panel-empty";
      empty.textContent =
        "Not yet investigated. Run the AI investigation for a verdict + factor breakdown.";
      section.appendChild(empty);
      return section;
    }

    if (investigation.status === "running") {
      const stale = bonIsInvestigationStale(investigation);
      const empty = document.createElement("p");
      empty.className = "bon-panel-empty";
      if (stale) {
        empty.textContent = investigation.startedAt
          ? `Stalled — started ${new Date(investigation.startedAt).toLocaleTimeString()}, never completed. Click investigate to retry.`
          : "Stalled — never completed. Click investigate to retry.";
      } else {
        empty.textContent = investigation.startedAt
          ? `Running since ${new Date(investigation.startedAt).toLocaleTimeString()}…`
          : "Running…";
      }
      section.appendChild(empty);
      return section;
    }

    if (investigation.status === "error") {
      const empty = document.createElement("p");
      empty.className = "bon-panel-empty";
      empty.textContent = `Investigation failed: ${investigation.error || "unknown error"}`;
      section.appendChild(empty);
      return section;
    }

    if (investigation.summary) {
      const summary = document.createElement("p");
      summary.className = "bon-panel-summary";
      summary.textContent = investigation.summary;
      section.appendChild(summary);
    }

    const metaParts = [];
    if (typeof investigation.confidence === "number") {
      metaParts.push(
        `overall confidence ${Math.round(investigation.confidence * 100)}%`
      );
    }
    if (investigation.runAt) {
      metaParts.push(
        `run ${new Date(investigation.runAt).toLocaleDateString()}`
      );
    }
    if (typeof investigation.postsFetched === "number") {
      metaParts.push(
        `${investigation.postsFetched} posts · ${investigation.commentsFetched ?? 0} comments`
      );
    }
    if (metaParts.length) {
      const meta = document.createElement("p");
      meta.className = "bon-panel-meta";
      meta.textContent = metaParts.join(" · ");
      section.appendChild(meta);
    }

    if (Array.isArray(investigation.factors) && investigation.factors.length) {
      section.appendChild(buildFactorsList(investigation.factors));
    }

    return section;
  }

  function buildFactorsList(factors) {
    const byKey = new Map(factors.map((f) => [f.key, f]));
    const ordered = [
      ...FACTOR_ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)),
      ...factors.filter((f) => !FACTOR_ORDER.includes(f.key)),
    ];
    const ul = document.createElement("ul");
    ul.className = "bon-panel-factors";
    for (const f of ordered) ul.appendChild(buildFactor(f));
    return ul;
  }

  function buildFactor(f) {
    const li = document.createElement("li");
    li.className = "bon-panel-factor";

    const header = document.createElement("div");
    header.className = "bon-panel-factor__header";

    const name = document.createElement("span");
    name.className = "bon-panel-factor__name";
    name.textContent = FACTOR_LABELS[f.key] || f.name || f.key || "factor";
    header.appendChild(name);

    if (typeof f.score === "number") {
      const leaning = scoreLeaning(f.score, f.confidence);
      const pill = document.createElement("span");
      pill.className = `bon-panel-factor__signal bon-panel-factor__signal--${leaning}`;
      pill.textContent =
        leaning === "neutral"
          ? "neutral"
          : `${leaning.replace(/-/g, " ")} ${Math.abs(f.score).toFixed(2)}`;
      header.appendChild(pill);
    }
    li.appendChild(header);

    if (f.reasoning) {
      const r = document.createElement("div");
      r.className = "bon-panel-factor__reasoning";
      r.textContent = f.reasoning;
      li.appendChild(r);
    }

    return li;
  }

  function scoreLeaning(score, confidence) {
    if (typeof score !== "number") return "neutral";
    if (typeof confidence === "number" && confidence < 0.2) return "neutral";
    if (score <= -0.5) return "bot";
    if (score <= -0.2) return "likely-bot";
    if (score >= 0.5) return "human";
    if (score >= 0.2) return "likely-human";
    return "neutral";
  }

  function buildReportsSection(report) {
    const history = report?.history || [];
    const section = document.createElement("div");
    section.className = "bon-panel-section";

    const title = document.createElement("p");
    title.className = "bon-panel-section__title";
    const label = document.createElement("span");
    label.textContent = `Reports (${history.length})`;
    title.appendChild(label);
    section.appendChild(title);

    if (history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "bon-panel-empty";
      empty.textContent = "No reports submitted from this extension yet.";
      section.appendChild(empty);
      return section;
    }

    const ul = document.createElement("ul");
    ul.className = "bon-panel-reports";

    const sorted = [...history].sort((a, b) => (b.at || 0) - (a.at || 0));
    const visible = sorted.slice(0, 8);
    for (const entry of visible) ul.appendChild(buildReportEntry(entry));
    section.appendChild(ul);

    if (sorted.length > visible.length) {
      const more = document.createElement("p");
      more.className = "bon-panel-reports__more";
      more.textContent = `+ ${sorted.length - visible.length} older — open the full reports view for all.`;
      section.appendChild(more);
    }

    return section;
  }

  function buildReportEntry(entry) {
    const li = document.createElement("li");

    const time = document.createElement("time");
    if (entry.at) {
      time.dateTime = new Date(entry.at).toISOString();
      time.textContent = formatPanelDate(entry.at);
      time.title = new Date(entry.at).toLocaleString();
    } else {
      time.textContent = "unknown";
    }
    li.appendChild(time);

    const kindIcon =
      entry.kind === "post" ? "📝" : entry.kind === "comment" ? "💬" : "";
    const statusIcon =
      entry.status === "removed"
        ? "🚫"
        : entry.status === "deleted"
          ? "❌"
          : "";
    const prefix = [statusIcon, kindIcon].filter(Boolean).join(" ");

    const labelParts = [];
    if (entry.subreddit) labelParts.push(entry.subreddit);
    if (entry.postTitle) labelParts.push(entry.postTitle);
    const labelText =
      (prefix ? `${prefix} ` : "") + (labelParts.join(" · ") || "report");

    const url = resolveReportUrl(entry.permalink);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = labelText;
      a.title = labelText;
      li.appendChild(a);
    } else {
      const span = document.createElement("span");
      span.textContent = labelText;
      span.title = labelText;
      li.appendChild(span);
    }

    return li;
  }

  function resolveReportUrl(permalink) {
    if (!permalink) return null;
    if (/^https?:\/\//i.test(permalink)) return permalink;
    if (permalink.startsWith("/")) return `https://www.reddit.com${permalink}`;
    return `https://www.reddit.com/${permalink}`;
  }

  function formatPanelDate(ts) {
    const diffMs = Date.now() - ts;
    const min = 60_000;
    const hour = 60 * min;
    const day = 24 * hour;
    if (diffMs < min) return "now";
    if (diffMs < hour) return `${Math.floor(diffMs / min)}m`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d`;
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, {
      year: sameYear ? undefined : "2-digit",
      month: "short",
      day: "numeric",
    });
  }

  function buildInvestigateBtn(username, investigation) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-panel-btn";
    const running = investigation?.status === "running";
    const stale = running && bonIsInvestigationStale(investigation);
    const verdict = investigation?.verdict;

    if (running && !stale) {
      btn.textContent = "⏳ investigating…";
      btn.disabled = true;
      btn.classList.add("bon-spinning");
    } else if (stale) {
      btn.textContent = "🔁 retry (stalled)";
    } else if (verdict) {
      btn.textContent = "🔁 re-investigate";
    } else {
      btn.textContent = "🤖 investigate";
    }

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.classList.add("bon-spinning");
      btn.textContent = "⏳ investigating…";
      try {
        const res = await browser.runtime.sendMessage({
          type: "investigate-user",
          username,
        });
        if (res?.ok === false && res.error === "no-api-key") {
          alert(
            "No Claude API key set. Open the Bot or Not popup → Settings to add one."
          );
          btn.disabled = false;
          btn.classList.remove("bon-spinning");
          btn.textContent = verdict ? "🔁 re-investigate" : "🤖 investigate";
        }
        // storage.onChanged will trigger refreshProfilePanel.
      } catch (err) {
        console.error("[Bot or Not] investigate failed", err);
        btn.disabled = false;
        btn.classList.remove("bon-spinning");
        btn.textContent = verdict ? "🔁 re-investigate" : "🤖 investigate";
      }
    });
    return btn;
  }

  function buildExternalCheckBtn(username) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-panel-btn";
    btn.textContent = "🔍 external check";
    btn.title = `Check Bot Bouncer, RedditMetis, ProfileProbe, Google for ${username}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      browser.runtime.sendMessage({
        type: "open-tabs",
        urls: [
          `https://www.reddit.com/r/BotBouncer/search/?q=${encodeURIComponent(username)}&restrict_sr=true`,
          `https://redditmetis.com/user/${encodeURIComponent(username)}`,
          `https://profileprobe.com/botornot/?u=${encodeURIComponent(username)}`,
          `https://www.google.com/search?q=${encodeURIComponent(`reddit "${username}"`)}`,
        ],
      });
    });
    return btn;
  }

  async function fetchAndStoreCakeDay(username) {
    try {
      const res = await fetch(
        `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return;
      const data = await res.json();
      const createdUtc = data?.data?.created_utc;
      if (!createdUtc) return;
      browser.runtime.sendMessage({
        type: "update-user-created-at",
        username,
        createdAt: Math.floor(createdUtc * 1000),
      });
    } catch (err) {
      console.error("[Bot or Not] failed to fetch cake day", err);
    }
  }

  injectPanel();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.reports) return;
    const panel = document.getElementById("bon-profile-panel");
    if (!panel) return;
    const username = panel.dataset.username;
    if (!username) return;
    refreshProfilePanel(username);
  });

  // --- Passive ban/deletion detection ---

  // Track what we've already reported per page-load to avoid spam
  let lastUserStatusReported = null;
  const reportedPostPermalinks = new Set();
  const reportedBotBouncerKeys = new Set();

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

  function detectBotBouncerStatuses() {
    document.querySelectorAll("shreddit-post").forEach((post) => {
      const subreddit = (
        post.getAttribute("subreddit-prefixed-name") ||
        post.getAttribute("subreddit-name") ||
        ""
      ).toLowerCase();
      if (!/(^|\/)botbouncer$/.test(subreddit)) return;

      const title = post.getAttribute("post-title") || "";
      const titleMatch = title.match(/^Overview for (\S+)/);
      if (!titleMatch) return;
      const username = titleMatch[1];

      let flairText = (
        post.getAttribute("flair-text") ||
        post.getAttribute("post-flair-text") ||
        post.getAttribute("link-flair-text") ||
        ""
      )
        .toLowerCase()
        .trim();

      if (!flairText) {
        const flairEl = post.querySelector(
          "shreddit-post-flair, [class*='flair']"
        );
        flairText = flairEl?.textContent?.trim().toLowerCase() || "";
      }

      const status = ["banned", "pending", "organic"].find(
        (s) => s === flairText
      );
      if (!status) return;

      const key = `${username.toLowerCase()}#${status}`;
      if (reportedBotBouncerKeys.has(key)) return;
      reportedBotBouncerKeys.add(key);

      browser.runtime.sendMessage({
        type: "update-botbouncer-status",
        username,
        status,
      });
    });
  }

  function runStatusDetection() {
    detectUserStatus();
    detectPostStatuses();
    detectStandalonePostStatus();
    detectBotBouncerStatuses();
  }

  runStatusDetection();

  // Reset detection state on SPA navigation
  let lastUrl = window.location.href;
  function maybeResetForNavigation() {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    lastUserStatusReported = null;
    reportedPostPermalinks.clear();
    reportedBotBouncerKeys.clear();
    pendingReport = null;
  }

  // Keep observer running permanently to handle SPA navigation and dynamic content
  const observer = new MutationObserver(() => {
    maybeResetForNavigation();
    injectPanel();
    markBots();
    runStatusDetection();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
