(function () {
  const { version } = browser.runtime.getManifest();
  console.log(`[Bot or Not] v${version} loaded`);

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
          // Optimistic tag for the just-reported user — storage.onChanged will
          // overwrite with the authoritative count moments later.
          const key = username.toLowerCase();
          const existing = userTags.get(key);
          userTags.set(key, {
            username,
            count: (existing?.count || 0) + 1,
            verdict: existing?.verdict ?? null,
            confidence: existing?.confidence ?? null,
            investigationStatus: existing?.investigationStatus ?? null,
            investigationStartedAt: existing?.investigationStartedAt ?? null,
            botBouncerStatus: existing?.botBouncerStatus ?? null,
            userStatus: existing?.userStatus ?? null,
          });
          refreshUserTag(username);
          pendingReport = null;
        }
      },
      true // capture phase — fires before Reddit's own handlers
    );
  }

  listenForReports();

  // --- Inline user tags (all Reddit pages) ---

  // Keyed by lowercase username so lookups match Reddit's case-insensitive
  // routing (a link can use any casing for the same account).
  let userTags = new Map();
  let tagsLoaded = false;

  async function loadUserTags() {
    const { tags = {} } = await browser.runtime.sendMessage({
      type: "get-user-tags",
    });
    userTags = new Map();
    for (const [username, info] of Object.entries(tags)) {
      userTags.set(username.toLowerCase(), { ...info, username });
    }
    tagsLoaded = true;
    resetAndMarkAll();
  }

  function tagVariant(info) {
    if (info.verdict) return info.verdict;
    if (info.investigationStatus === "running") return "running";
    if (info.count > 0) return "reported";
    if (info.botBouncerStatus === "banned") return "bot";
    if (info.userStatus === "suspended") return "bot";
    return "reported";
  }

  function tagLabel(info, variant) {
    if (variant === "running") return "Investigating";
    if (variant === "reported") {
      return info.count > 0
        ? `${info.count} report${info.count === 1 ? "" : "s"}`
        : "Flagged";
    }
    return formatVerdict(variant);
  }

  function formatVerdict(verdict) {
    if (!verdict) return "";
    const spaced = verdict.replace(/-/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function tagTitle(info, variant) {
    const parts = [`@${info.username}`];
    if (info.verdict) {
      const conf =
        typeof info.confidence === "number"
          ? ` (${Math.round(info.confidence * 100)}% confidence)`
          : "";
      parts.push(`AI verdict: ${formatVerdict(info.verdict)}${conf}`);
    } else if (variant === "running") {
      parts.push("AI investigation in progress");
    }
    if (info.count > 0) {
      parts.push(
        `${info.count} report${info.count === 1 ? "" : "s"} from this extension`
      );
    }
    if (info.botBouncerStatus) {
      parts.push(`Bot Bouncer: ${info.botBouncerStatus}`);
    }
    if (info.userStatus) {
      parts.push(`Account: ${info.userStatus}`);
    }
    return parts.join(" — ");
  }

  function buildUserTag(info) {
    const variant = tagVariant(info);
    const tag = document.createElement("span");
    tag.className = `bon-user-tag bon-user-tag--${variant}`;
    tag.dataset.bonTagFor = info.username.toLowerCase();
    tag.setAttribute("role", "button");
    tag.setAttribute("tabindex", "0");
    tag.title = tagTitle(info, variant);
    tag.textContent = tagLabel(info, variant);
    return tag;
  }

  function isAvatarLink(el) {
    // Avatar-wrapping anchors have no visible text — just an image/icon.
    // Tagging them puts the pill in the wrong layout slot (often a column
    // flex container), so it wraps to its own line below the username row.
    if (el.textContent && el.textContent.trim()) return false;
    return !!el.querySelector("img, svg, shreddit-avatar, faceplate-img");
  }

  function markUsers() {
    if (!tagsLoaded) return;
    document
      .querySelectorAll(
        'a[href*="/user/"]:not([data-bon-marked]), a[href*="/u/"]:not([data-bon-marked])'
      )
      .forEach((el) => {
        const href = el.getAttribute("href");
        const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
        if (!match) return;
        if (el.closest('[id^="profile-tab"]')) return;
        el.dataset.bonMarked = "true";
        if (isAvatarLink(el)) return;
        const info = userTags.get(match[1].toLowerCase());
        if (!info) return;
        const key = match[1].toLowerCase();
        // Skip if a tag for this user already sits next to this link (Reddit
        // sometimes re-parents anchors, dropping the data-bon-marked flag).
        if (
          el.nextElementSibling?.classList?.contains("bon-user-tag") &&
          el.nextElementSibling.dataset.bonTagFor === key
        ) {
          return;
        }
        // Scoped dedup: post headers often contain multiple anchors for the
        // same user (avatar + username link). Only one pill per header.
        const scope =
          el.closest("shreddit-post, shreddit-comment, article, header") ||
          el.parentElement;
        if (
          scope?.querySelector(
            `.bon-user-tag[data-bon-tag-for="${cssEscape(key)}"]`
          )
        ) {
          return;
        }
        el.insertAdjacentElement("afterend", buildUserTag(info));
      });
  }

  function refreshUserTag(username) {
    const key = username.toLowerCase();
    document
      .querySelectorAll(`.bon-user-tag[data-bon-tag-for="${cssEscape(key)}"]`)
      .forEach((t) => t.remove());
    document
      .querySelectorAll('a[href*="/user/"], a[href*="/u/"]')
      .forEach((el) => {
        const href = el.getAttribute("href");
        const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
        if (!match || match[1].toLowerCase() !== key) return;
        delete el.dataset.bonMarked;
      });
    markUsers();
  }

  function resetAndMarkAll() {
    document.querySelectorAll(".bon-user-tag").forEach((t) => t.remove());
    document
      .querySelectorAll("a[data-bon-marked]")
      .forEach((el) => delete el.dataset.bonMarked);
    markUsers();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  loadUserTags();

  document.addEventListener(
    "click",
    (e) => {
      const tag = e.target?.closest?.(".bon-user-tag");
      if (!tag) return;
      e.preventDefault();
      e.stopPropagation();
      browser.runtime.sendMessage({ type: "open-popup" });
    },
    true
  );

  // --- Profile panel injection (profile pages only, SPA-aware) ---

  // Canonical factor metadata lives in factors.js (loaded before this script
  // in manifest.json). Stored investigations may contain keys not in this
  // list (deprecated) — those are dropped. Keys in this list missing from a
  // stored investigation render as "added after" placeholders so old reports
  // stay readable without re-running.
  const FACTOR_LABELS = BON_FACTOR_LABELS;
  const FACTOR_ORDER = BON_FACTOR_KEYS;

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
    // Visiting a profile is itself a "is this a bot?" signal. Background
    // dedups against existing done/error/running investigations.
    browser.runtime.sendMessage({
      type: "auto-investigate-on-view",
      username,
    });
  }

  function injectPanel() {
    injectProfilePanel();
    injectPostAuthorPanel();
  }

  function injectProfilePanel() {
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
      // If Reddit's reconciliation moved the panel inside a post/comment in
      // the user's feed below, treat it as missing and re-inject up top.
      const misplaced = isPanelMisplaced(existingPanel);
      if (!misplaced && existingPanel.dataset.username === username) return;
      existingPanel.remove();
    }

    if (!findProfileH1()) return;

    ensureProfilePanel(username);
  }

  function findProfileH1() {
    // After Reddit's SPA renders the user's post feed, each post has its own
    // h1. If we use `document.querySelector("h1")` during a transient
    // re-render where the header h1 is briefly detached, we can grab a post
    // title h1 instead and anchor the panel inside that post.
    for (const h1 of document.querySelectorAll("h1")) {
      if (h1.closest("shreddit-post, shreddit-comment, article")) continue;
      return h1;
    }
    return null;
  }

  function isPanelMisplaced(panel) {
    return !!panel.closest("shreddit-post, shreddit-comment, article");
  }

  function injectPostAuthorPanel() {
    const postMatch = window.location.pathname.match(
      /^(\/r\/[^/]+\/comments\/[^/]+)/i
    );

    // Not on a post detail page — remove panel if present
    if (!postMatch) {
      const existingPanel = document.getElementById("bon-post-author-panel");
      if (existingPanel) existingPanel.remove();
      return;
    }

    // Reddit's SPA updates the URL via pushState before unmounting the feed,
    // so `querySelector("shreddit-post")` during that window picks up a feed
    // post instead of the destination post. Match the URL permalink against
    // each post's `permalink` attribute and only inject once the actual post
    // is in the DOM.
    const urlBase = postMatch[1].toLowerCase();
    const postEl = Array.from(document.querySelectorAll("shreddit-post")).find(
      (p) =>
        (p.getAttribute("permalink") || "").toLowerCase().startsWith(urlBase)
    );
    if (!postEl) {
      // Drop any stale panel sitting on a feed post we're navigating away from.
      const existingPanel = document.getElementById("bon-post-author-panel");
      if (existingPanel) existingPanel.remove();
      return;
    }
    const username = postEl.getAttribute("author");
    if (!username || username === "[deleted]" || username === "AutoModerator")
      return;

    const existingPanel = document.getElementById("bon-post-author-panel");
    if (existingPanel) {
      const onCorrectPost = existingPanel.closest("shreddit-post") === postEl;
      if (onCorrectPost && existingPanel.dataset.username === username) return;
      existingPanel.remove();
    }

    ensurePostAuthorPanel(username, postEl);
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
    const h1 = findProfileH1();
    if (!h1) return;

    const existing = document.getElementById("bon-profile-panel");
    const wasExpanded =
      existing
        ?.querySelector(".bon-profile-panel__body")
        ?.classList.contains("bon-profile-panel__body--expanded") ?? false;

    const fresh = buildProfilePanel(username, report, {
      expanded: wasExpanded,
      id: "bon-profile-panel",
    });
    if (existing && !isPanelMisplaced(existing)) {
      existing.replaceWith(fresh);
      return;
    }
    // Misplaced (e.g., Reddit reparented it inside a feed post) — drop the
    // stale node so the wrapper logic below re-anchors at the header.
    if (existing) existing.remove();

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

  function ensurePostAuthorPanel(username, postEl) {
    if (document.getElementById("bon-post-author-panel")) return;
    if (reportCache.has(username)) {
      renderPostAuthorPanel(username, postEl, reportCache.get(username));
    } else {
      refreshPostAuthorPanel(username, postEl);
    }
  }

  async function refreshPostAuthorPanel(username, postEl) {
    const postMatch = window.location.pathname.match(
      /^\/r\/[^/]+\/comments\/[^/]+/i
    );
    if (!postMatch) return;
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
    renderPostAuthorPanel(username, postEl, report);
    if (report && !report.createdAt) {
      fetchAndStoreCakeDay(username);
    }
  }

  function renderPostAuthorPanel(username, postEl, report) {
    // postEl may have been detached by Reddit's SPA re-render; re-resolve it
    if (!postEl || !postEl.isConnected) {
      postEl = document.querySelector("shreddit-post");
      if (!postEl) return;
    }

    const existing = document.getElementById("bon-post-author-panel");
    const wasExpanded =
      existing
        ?.querySelector(".bon-profile-panel__body")
        ?.classList.contains("bon-profile-panel__body--expanded") ?? false;

    const fresh = buildProfilePanel(username, report, {
      expanded: wasExpanded,
      id: "bon-post-author-panel",
    });

    // Only swap in place if the existing panel is still attached to the
    // correct post — otherwise it's stranded on a stale feed post and we
    // re-anchor via the credit-bar slot logic below.
    if (existing && existing.closest("shreddit-post") === postEl) {
      // Preserve slot assignment. `buildProfilePanel` doesn't know about
      // shreddit-post's named slots, so without copying slot="credit-bar"
      // here the fresh node falls into the unnamed slot and renders below
      // the post body.
      const slot = existing.getAttribute("slot");
      if (slot) fresh.setAttribute("slot", slot);
      existing.replaceWith(fresh);
      return;
    }
    if (existing) existing.remove();

    // shreddit-post uses named slots; the byline lives in slot="credit-bar".
    // Adding another child with the same slot name renders it at the slot's
    // position in light-DOM document order, so placing it after the existing
    // credit-bar element puts the panel directly below the byline and above
    // the title.
    const creditBar = postEl.querySelector('[slot="credit-bar"]');
    if (creditBar) {
      fresh.setAttribute("slot", "credit-bar");
      creditBar.parentElement.insertBefore(fresh, creditBar.nextSibling);
      return;
    }
    postEl.parentElement?.insertBefore(fresh, postEl);
  }

  function buildProfilePanel(
    username,
    report,
    { expanded = false, id = "bon-profile-panel" } = {}
  ) {
    const panel = document.createElement("div");
    panel.id = id;
    panel.className = "bon-profile-panel";
    panel.dataset.username = username;

    const investigation = bonNormalizeInvestigation(report?.investigation);

    // Nested <button> is invalid HTML, and we want the re-investigate button
    // sitting inside the header — so the toggle target is a div with button
    // semantics rather than a real <button> element.
    const header = document.createElement("div");
    header.className = "bon-profile-panel__header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", String(expanded));

    const title = document.createElement("span");
    title.className = "bon-profile-panel__title";
    title.textContent = "Bot or Not";
    header.appendChild(title);

    const stats = document.createElement("span");
    stats.className = "bon-profile-panel__stats";
    appendStatPills(stats, report);
    header.appendChild(stats);

    header.appendChild(buildInvestigateBtn(username, investigation));

    const preview = buildPanelPreview(username, report);

    const body = document.createElement("div");
    body.className = "bon-profile-panel__body";
    body.classList.toggle("bon-profile-panel__body--expanded", expanded);
    const bodyInner = document.createElement("div");
    bodyInner.className = "bon-profile-panel__body-inner";
    bodyInner.appendChild(buildInvestigationSection(username, report));
    bodyInner.appendChild(buildReportsSection(report));
    body.appendChild(bodyInner);

    const toggleLink = document.createElement("button");
    toggleLink.type = "button";
    toggleLink.className = "bon-profile-panel__toggle";
    toggleLink.textContent = expanded ? "Show less" : "Show more";

    const toggle = () => {
      const isExpanded = header.getAttribute("aria-expanded") === "true";
      const next = !isExpanded;
      header.setAttribute("aria-expanded", String(next));
      body.classList.toggle("bon-profile-panel__body--expanded", next);
      toggleLink.textContent = next ? "Show less" : "Show more";
    };

    header.addEventListener("click", (e) => {
      if (e.target.closest("button, a")) return;
      toggle();
    });
    header.addEventListener("keydown", (e) => {
      if (e.target !== header) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    if (preview) {
      preview.addEventListener("click", (e) => {
        if (e.target.closest("button, a")) return;
        toggle();
      });
    }
    toggleLink.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    panel.appendChild(header);
    if (preview) {
      preview.appendChild(toggleLink);
      panel.appendChild(preview);
    } else {
      const toggleRow = document.createElement("div");
      toggleRow.className = "bon-profile-panel__toggle-row";
      toggleRow.appendChild(toggleLink);
      panel.appendChild(toggleRow);
    }
    panel.appendChild(body);
    return panel;
  }

  function buildPanelPreview(username, report) {
    const investigation = bonNormalizeInvestigation(report?.investigation);
    const hasFactors =
      Array.isArray(investigation?.factors) && investigation.factors.length > 0;
    if (!investigation?.summary && !hasFactors) return null;

    const preview = document.createElement("div");
    preview.className = "bon-profile-panel__preview";

    const summaryCol = document.createElement("div");
    summaryCol.className = "bon-profile-panel__preview-summary";
    if (investigation.summary) {
      const p = document.createElement("p");
      p.className = "bon-profile-panel__summary";
      p.textContent = investigation.summary;
      summaryCol.appendChild(p);
    }
    if (hasFactors) {
      const reasons = buildTopReasonsList(investigation.factors);
      if (reasons) summaryCol.appendChild(reasons);
    }
    // Factor dot strip lives in the always-visible preview so the at-a-glance
    // signal map is readable without expanding the panel. Each dot carries a
    // hover-card popover with the full factor reasoning + evidence. Tucked
    // under the summary in the left column so it fills the vertical space
    // the persona card claims on the right.
    if (investigation?.status === "done") {
      const dotsGroup = document.createElement("div");
      dotsGroup.className = "bon-panel-factor-signals";
      const dotsLabel = document.createElement("p");
      dotsLabel.className = "bon-panel-factor-signals__label";
      dotsLabel.textContent = "Factor signals — hover for details";
      dotsGroup.appendChild(dotsLabel);
      dotsGroup.appendChild(buildFactorDots(investigation));
      summaryCol.appendChild(dotsGroup);
    }

    const personaBlock = investigation?.persona?.label
      ? buildPersonaStrip(investigation.persona)
      : null;

    if (personaBlock && summaryCol.childNodes.length) {
      const row = document.createElement("div");
      row.className = "bon-profile-panel__preview-row";
      row.appendChild(summaryCol);
      row.appendChild(personaBlock);
      preview.appendChild(row);
    } else {
      if (summaryCol.childNodes.length) preview.appendChild(summaryCol);
      if (personaBlock) preview.appendChild(personaBlock);
    }

    return preview;
  }

  function buildPersonaStrip(persona) {
    const wrap = document.createElement("aside");
    wrap.className = `bon-panel-persona bon-panel-persona--${persona.label}`;

    const tag = document.createElement("p");
    tag.className = "bon-panel-persona__tag";
    tag.textContent = "Persona profile";
    wrap.appendChild(tag);

    if (persona.archetypes) {
      const radar = buildPersonaRadar(persona.archetypes);
      if (radar) wrap.appendChild(radar);
    }

    const label = document.createElement("p");
    label.className = "bon-panel-persona__label";
    const labelText =
      persona.label === "normal"
        ? "Normal"
        : BON_ARCHETYPES.find((a) => a.key === persona.label)?.label ||
          persona.label;
    label.textContent = labelText;
    wrap.appendChild(label);

    if (persona.reasoning) {
      const blurb = document.createElement("p");
      blurb.className = "bon-panel-persona__blurb";
      blurb.textContent = persona.reasoning;
      wrap.appendChild(blurb);
    }

    return wrap;
  }

  const BON_PANEL_RADAR_VIEW = {
    size: 220,
    center: 110,
    radius: 76,
    labelPad: 14,
    gridLevels: 4,
  };

  function buildPersonaRadar(archetypes) {
    if (!archetypes) return null;
    const svgns = "http://www.w3.org/2000/svg";
    const v = BON_PANEL_RADAR_VIEW;
    const axes = BON_ARCHETYPES;
    const N = axes.length;
    if (N < 3) return null;

    const step = (Math.PI * 2) / N;
    const angle = (i) => -Math.PI / 2 + i * step;
    const vertex = (i, scale) => {
      const θ = angle(i);
      return {
        x: v.center + v.radius * scale * Math.cos(θ),
        y: v.center + v.radius * scale * Math.sin(θ),
      };
    };
    const points = (scale) =>
      axes
        .map((_, i) => {
          const p = vertex(i, scale);
          return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        })
        .join(" ");

    const wrap = document.createElement("div");
    wrap.className = "bon-panel-persona-radar";
    wrap.title = axes
      .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
      .join("  ·  ");

    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("viewBox", `0 0 ${v.size} ${v.size}`);
    svg.setAttribute("class", "bon-panel-radar");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `Persona radar: ${axes
        .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
        .join(", ")}`
    );

    for (let g = 1; g <= v.gridLevels; g++) {
      const poly = document.createElementNS(svgns, "polygon");
      poly.setAttribute("points", points(g / v.gridLevels));
      poly.setAttribute(
        "class",
        g === v.gridLevels
          ? "bon-panel-radar-grid bon-panel-radar-grid--outer"
          : "bon-panel-radar-grid"
      );
      svg.appendChild(poly);
    }

    for (let i = 0; i < N; i++) {
      const p = vertex(i, 1);
      const line = document.createElementNS(svgns, "line");
      line.setAttribute("x1", v.center);
      line.setAttribute("y1", v.center);
      line.setAttribute("x2", p.x.toFixed(2));
      line.setAttribute("y2", p.y.toFixed(2));
      line.setAttribute("class", "bon-panel-radar-axis");
      svg.appendChild(line);
    }

    const dataPolyPts = axes
      .map((a, i) => {
        const score = Math.max(0, Math.min(1, archetypes[a.key] || 0));
        const p = vertex(i, score);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      })
      .join(" ");
    const dataPoly = document.createElementNS(svgns, "polygon");
    dataPoly.setAttribute("points", dataPolyPts);
    dataPoly.setAttribute("class", "bon-panel-radar-data");
    svg.appendChild(dataPoly);

    for (let i = 0; i < N; i++) {
      const score = archetypes[axes[i].key] || 0;
      if (score <= 0.05) continue;
      const p = vertex(i, score);
      const dot = document.createElementNS(svgns, "circle");
      dot.setAttribute("cx", p.x.toFixed(2));
      dot.setAttribute("cy", p.y.toFixed(2));
      dot.setAttribute("r", 3);
      dot.setAttribute("class", "bon-panel-radar-dot");
      svg.appendChild(dot);
    }

    for (let i = 0; i < N; i++) {
      const θ = angle(i);
      const lx = v.center + (v.radius + v.labelPad) * Math.cos(θ);
      const ly = v.center + (v.radius + v.labelPad) * Math.sin(θ);
      const cosθ = Math.cos(θ);
      const sinθ = Math.sin(θ);
      let anchor = "middle";
      if (cosθ > 0.3) anchor = "start";
      else if (cosθ < -0.3) anchor = "end";
      let dy = "0.35em";
      if (sinθ > 0.4) dy = "0.85em";
      else if (sinθ < -0.4) dy = "-0.1em";

      const text = document.createElementNS(svgns, "text");
      text.setAttribute("x", lx.toFixed(2));
      text.setAttribute("y", ly.toFixed(2));
      text.setAttribute("text-anchor", anchor);
      text.setAttribute("dy", dy);
      text.setAttribute("class", "bon-panel-radar-label");
      text.textContent = axes[i].label;
      svg.appendChild(text);
    }

    wrap.appendChild(svg);
    return wrap;
  }

  function buildTopReasonsList(factors) {
    const top = bonTopReasons(factors, 3);
    if (!top.length) return null;
    const ul = document.createElement("ul");
    ul.className = "bon-profile-panel__reasons";
    for (const f of top) {
      const li = document.createElement("li");
      const leaning = scoreLeaning(f.score, f.confidence);
      li.className = `bon-reason bon-reason--${leaning}`;
      const bullet = document.createElement("span");
      bullet.className = "bon-reason__bullet";
      bullet.setAttribute("aria-hidden", "true");
      li.appendChild(bullet);
      const text = document.createElement("span");
      text.className = "bon-reason__text";
      const label = document.createElement("strong");
      label.textContent = FACTOR_LABELS[f.key] || f.name || f.key || "Factor";
      text.appendChild(label);
      if (f.reasoning) {
        text.appendChild(document.createTextNode(` — ${f.reasoning}`));
      }
      li.appendChild(text);
      ul.appendChild(li);
    }
    return ul;
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
      span.textContent = stale ? "🤖 Stalled" : "🤖 Investigating…";
      span.title = stale
        ? "AI investigation appears orphaned — click investigate to retry"
        : "AI investigation in progress";
      return span;
    }
    if (investigation.status === "error") {
      span.className = "bon-stat-pill bon-stat-pill--verdict-error";
      span.textContent = "🤖 Error";
      span.title = investigation.error || "Investigation failed";
      return span;
    }
    const norm = bonNormalizeInvestigation(investigation);
    if (!norm.verdict) return null;
    span.className = `bon-stat-pill bon-stat-pill--verdict-${norm.verdict}`;
    span.textContent = `🤖 ${formatVerdict(norm.verdict)}`;
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

    // Factor dots have moved up to the always-visible preview — the body
    // section keeps the detailed per-factor cards only.
    if (Array.isArray(investigation.factors) && investigation.factors.length) {
      section.appendChild(buildFactorsList(investigation.factors));
    }

    return section;
  }

  function buildFactorDots(investigation) {
    const wrap = document.createElement("div");
    wrap.className = "bon-panel-factor-dots";
    const byKey = new Map();
    if (Array.isArray(investigation?.factors)) {
      for (const f of investigation.factors) {
        if (f?.key) byKey.set(f.key, f);
      }
    }
    const hasRun = investigation?.status === "done";
    for (const key of FACTOR_ORDER) {
      wrap.appendChild(buildFactorDot(key, byKey.get(key), hasRun));
    }
    return wrap;
  }

  function buildFactorDot(key, f, hasRun) {
    const fullLabel = FACTOR_LABELS[key] || key;

    const dot = document.createElement("span");
    dot.className = "bon-panel-factor-dot";
    dot.tabIndex = 0;

    let leaning;
    if (f && typeof f.score === "number") {
      leaning = scoreLeaning(f.score, f.confidence);
    } else if (!f && hasRun) {
      leaning = "new";
    } else if (!f) {
      leaning = "missing";
    } else {
      leaning = "neutral";
    }
    dot.classList.add(`bon-panel-factor-dot--${leaning}`);

    if (f) {
      const confText =
        typeof f.confidence === "number"
          ? `${Math.round(f.confidence * 100)}%`
          : "—";
      dot.setAttribute(
        "aria-label",
        `${fullLabel}: ${leaning === "neutral" ? "neutral" : formatVerdict(leaning)} · ${confText} confidence`
      );
    } else if (hasRun) {
      dot.setAttribute(
        "aria-label",
        `${fullLabel}: added after this investigation ran — re-run to score`
      );
    } else {
      dot.setAttribute("aria-label", `${fullLabel}: not investigated`);
    }

    const card = buildFactorDotCard(fullLabel, f, hasRun, leaning);
    dot.appendChild(card);
    attachFactorCardPositioning(dot, card);
    return dot;
  }

  // position: fixed alone isn't enough: any transform/filter on an ancestor
  // (Reddit's chrome is full of them) re-roots the fixed-position containing
  // block to that ancestor, breaking viewport coordinates. So on first hover
  // we move the card out of the dot and into document.body — guaranteed to
  // sit under <html>, so fixed positioning lands in true viewport space.
  // Show/hide is then class-toggled (the CSS :hover rule wouldn't fire on a
  // card that's no longer a descendant of the dot).
  function attachFactorCardPositioning(dotEl, cardEl) {
    let mounted = false;
    const show = () => {
      if (!mounted) {
        document.body.appendChild(cardEl);
        mounted = true;
      }
      const dotRect = dotEl.getBoundingClientRect();
      const cardWidth = cardEl.offsetWidth;
      const cardHeight = cardEl.offsetHeight;
      if (!cardWidth || !cardHeight) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      const gap = 10;

      let left = dotRect.left + dotRect.width / 2 - cardWidth / 2;
      left = Math.max(margin, Math.min(left, vw - margin - cardWidth));

      let top = dotRect.top - cardHeight - gap;
      if (top < margin) top = dotRect.bottom + gap;
      top = Math.max(margin, Math.min(top, vh - margin - cardHeight));

      cardEl.style.left = `${left}px`;
      cardEl.style.top = `${top}px`;
      cardEl.classList.add("bon-panel-factor-card--visible");
    };
    const hide = () => {
      cardEl.classList.remove("bon-panel-factor-card--visible");
    };
    dotEl.addEventListener("mouseenter", show);
    dotEl.addEventListener("mouseleave", hide);
    dotEl.addEventListener("focus", show);
    dotEl.addEventListener("blur", hide);
  }

  // Hover card popover for a factor dot. Mirrors the structure of the
  // expanded factor cards (name + signal pill + reasoning + evidence) but
  // sized for a tooltip and lives inside the dot so a single :hover/:focus-
  // within rule reveals it. CSS in content_script.css.
  function buildFactorDotCard(fullLabel, f, hasRun, leaning) {
    const card = document.createElement("span");
    // The leaning modifier carries the --bon-panel-factor-accent custom
    // property forward when the card is hoisted to document.body for
    // positioning — at that point inheritance from the dot is severed.
    card.className = `bon-panel-factor-card bon-panel-factor-card--${leaning}`;
    card.setAttribute("role", "tooltip");

    const header = document.createElement("span");
    header.className = "bon-panel-factor-card__header";
    const name = document.createElement("span");
    name.className = "bon-panel-factor-card__name";
    name.textContent = fullLabel;
    header.appendChild(name);

    if (f && typeof f.score === "number") {
      const pill = document.createElement("span");
      pill.className = `bon-panel-factor-card__signal bon-panel-factor-card__signal--${leaning}`;
      pill.textContent =
        leaning === "neutral" ? "Neutral" : formatVerdict(leaning);
      header.appendChild(pill);
    }
    card.appendChild(header);

    if (f && typeof f.confidence === "number") {
      const conf = document.createElement("span");
      conf.className = "bon-panel-factor-card__confidence";
      conf.textContent = `${Math.round(f.confidence * 100)}% confidence`;
      card.appendChild(conf);
    }

    if (f?.reasoning) {
      const r = document.createElement("span");
      r.className = "bon-panel-factor-card__reasoning";
      r.textContent = f.reasoning;
      card.appendChild(r);
    } else if (!f && hasRun) {
      const r = document.createElement("span");
      r.className =
        "bon-panel-factor-card__reasoning bon-panel-factor-card__reasoning--muted";
      r.textContent = "Added after this investigation ran — re-run to score.";
      card.appendChild(r);
    } else if (!f) {
      const r = document.createElement("span");
      r.className =
        "bon-panel-factor-card__reasoning bon-panel-factor-card__reasoning--muted";
      r.textContent = "Not investigated.";
      card.appendChild(r);
    }

    if (f && Array.isArray(f.evidence) && f.evidence.length) {
      const list = document.createElement("ul");
      list.className = "bon-panel-factor-card__evidence";
      for (const cite of f.evidence) {
        const item = document.createElement("li");
        item.textContent = cite;
        list.appendChild(item);
      }
      card.appendChild(list);
    }

    return card;
  }

  function buildFactorsList(factors) {
    const byKey = new Map(factors.map((f) => [f.key, f]));
    const ul = document.createElement("ul");
    ul.className = "bon-panel-factors";
    // Walk the canonical key list so factors added since the report ran appear
    // as placeholders in the right position, and stored factors that have
    // since been removed from the schema are dropped silently.
    for (const key of FACTOR_ORDER) {
      const f = byKey.get(key);
      if (f) {
        ul.appendChild(buildFactor(f));
      } else {
        ul.appendChild(buildMissingFactor(key));
      }
    }
    return ul;
  }

  function buildMissingFactor(key) {
    const li = document.createElement("li");
    li.className = "bon-panel-factor bon-panel-factor--new";

    const header = document.createElement("div");
    header.className = "bon-panel-factor__header";

    const name = document.createElement("span");
    name.className = "bon-panel-factor__name";
    name.textContent = FACTOR_LABELS[key] || key;
    header.appendChild(name);

    const pill = document.createElement("span");
    pill.className = "bon-panel-factor__signal bon-panel-factor__signal--new";
    pill.textContent = "Added later";
    header.appendChild(pill);
    li.appendChild(header);

    const note = document.createElement("div");
    note.className =
      "bon-panel-factor__reasoning bon-panel-factor__reasoning--muted";
    note.textContent =
      "Added after this investigation ran — re-run to include it.";
    li.appendChild(note);

    return li;
  }

  function buildFactor(f) {
    const li = document.createElement("li");
    li.className = "bon-panel-factor";

    const header = document.createElement("div");
    header.className = "bon-panel-factor__header";

    const name = document.createElement("span");
    name.className = "bon-panel-factor__name";
    name.textContent = FACTOR_LABELS[f.key] || f.name || f.key || "Factor";
    header.appendChild(name);

    if (typeof f.score === "number") {
      const leaning = scoreLeaning(f.score, f.confidence);
      const pill = document.createElement("span");
      pill.className = `bon-panel-factor__signal bon-panel-factor__signal--${leaning}`;
      pill.textContent =
        leaning === "neutral" ? "Neutral" : formatVerdict(leaning);
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
      btn.textContent = "⏳ Investigating…";
      btn.disabled = true;
      btn.classList.add("bon-spinning");
    } else if (stale) {
      btn.textContent = "🔁 Retry (stalled)";
    } else if (verdict) {
      btn.textContent = "🔁 Re-investigate";
    } else {
      btn.textContent = "🤖 Investigate";
    }

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.classList.add("bon-spinning");
      btn.textContent = "⏳ Investigating…";
      try {
        const res = await browser.runtime.sendMessage({
          type: "investigate-user",
          username,
        });
        if (res?.ok === false && res.error === "no-api-key") {
          alert(
            "No Claude API key set. Click the Bot or Not toolbar icon, then open Settings to add one."
          );
          btn.disabled = false;
          btn.classList.remove("bon-spinning");
          btn.textContent = verdict ? "🔁 Re-investigate" : "🤖 Investigate";
        }
        // storage.onChanged will trigger refreshProfilePanel.
      } catch (err) {
        console.error("[Bot or Not] investigate failed", err);
        btn.disabled = false;
        btn.classList.remove("bon-spinning");
        btn.textContent = verdict ? "🔁 Re-investigate" : "🤖 Investigate";
      }
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
    loadUserTags();
    const profilePanel = document.getElementById("bon-profile-panel");
    if (profilePanel?.dataset.username) {
      refreshProfilePanel(profilePanel.dataset.username);
    }
    const postPanel = document.getElementById("bon-post-author-panel");
    if (postPanel?.dataset.username) {
      const postEl = document.querySelector("shreddit-post");
      refreshPostAuthorPanel(postPanel.dataset.username, postEl);
    }
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
    markUsers();
    runStatusDetection();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
