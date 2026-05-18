// Injects the Bot-or-Not profile panel on Reddit profile pages and on
// standalone post pages (anchored to the post author byline). Owns the
// per-feature injection state: report cache, anchor discovery, SPA-aware
// re-injection, and the storage listener that re-renders on data changes.
// The orchestrator calls `bonProfilePanelInject` on every MutationObserver
// tick so we re-anchor immediately when Reddit's SPA reparents nodes.

import { bonPanelFetchAndStoreCakeDay } from "./cake_day.js";
import { bonPanelBuildProfilePanel } from "./panel.js";

// Cache last-known report per user so MutationObserver-driven re-inserts
// can render synchronously instead of waiting on a round-trip to the
// background page.
const reportCache = new Map();

function findProfileH1() {
  // After Reddit's SPA renders the user's post feed, each post has its own
  // h1. If we use `document.querySelector("h1")` during a transient
  // re-render where the header h1 is briefly detached, we can grab a post
  // title h1 instead and anchor the panel inside that post.
  for (const h1 of document.querySelectorAll("h1")) {
    if (h1.closest("shreddit-post, shreddit-comment, article")) {
      continue;
    }
    return h1;
  }
  return null;
}

function isPanelMisplaced(panel) {
  return !!panel.closest("shreddit-post, shreddit-comment, article");
}

function ensureProfilePanel(username) {
  if (document.getElementById("bon-profile-panel")) {
    return;
  }
  if (reportCache.has(username)) {
    renderProfilePanel(username, reportCache.get(username));
  } else {
    void refreshProfilePanel(username);
  }
  // Visiting a profile is itself a "is this a bot?" signal. Background
  // dedups against existing done/error/running investigations.
  browser.runtime.sendMessage({
    type: "auto-investigate-on-view",
    username,
  });
}

function injectProfilePanel() {
  const profileMatch = window.location.pathname.match(
    /^\/(?:user|u)\/([^/?#]+)/i
  );

  if (!profileMatch) {
    const existingPanel = document.getElementById("bon-profile-panel");
    if (existingPanel) {
      existingPanel.remove();
    }
    return;
  }

  const username = profileMatch[1];

  const existingPanel = document.getElementById("bon-profile-panel");
  if (existingPanel) {
    // If Reddit's reconciliation moved the panel inside a post/comment in
    // the user's feed below, treat it as missing and re-inject up top.
    const misplaced = isPanelMisplaced(existingPanel);
    if (!misplaced && existingPanel.dataset.username === username) {
      return;
    }
    existingPanel.remove();
  }

  if (!findProfileH1()) {
    return;
  }

  ensureProfilePanel(username);
}

function injectPostAuthorPanel() {
  const postMatch = window.location.pathname.match(
    /^(\/r\/[^/]+\/comments\/[^/]+)/i
  );

  if (!postMatch) {
    const existingPanel = document.getElementById("bon-post-author-panel");
    if (existingPanel) {
      existingPanel.remove();
    }
    return;
  }

  // Reddit's SPA updates the URL via pushState before unmounting the feed,
  // so `querySelector("shreddit-post")` during that window picks up a feed
  // post instead of the destination post. Match the URL permalink against
  // each post's `permalink` attribute and only inject once the actual post
  // is in the DOM.
  const urlBase = postMatch[1].toLowerCase();
  const postEl = Array.from(document.querySelectorAll("shreddit-post")).find(
    (p) => (p.getAttribute("permalink") || "").toLowerCase().startsWith(urlBase)
  );
  if (!postEl) {
    // Drop any stale panel sitting on a feed post we're navigating away from.
    const existingPanel = document.getElementById("bon-post-author-panel");
    if (existingPanel) {
      existingPanel.remove();
    }
    return;
  }
  const username = postEl.getAttribute("author");
  if (!username || username === "[deleted]" || username === "AutoModerator") {
    return;
  }

  const existingPanel = document.getElementById("bon-post-author-panel");
  if (existingPanel) {
    const onCorrectPost = existingPanel.closest("shreddit-post") === postEl;
    if (onCorrectPost && existingPanel.dataset.username === username) {
      return;
    }
    existingPanel.remove();
  }

  ensurePostAuthorPanel(username, postEl);
}

async function refreshProfilePanel(username) {
  const profileMatch = window.location.pathname.match(
    /^\/(?:user|u)\/([^/?#]+)/i
  );
  if (!profileMatch || profileMatch[1] !== username) {
    return;
  }
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
    void bonPanelFetchAndStoreCakeDay(username);
  }
}

function renderProfilePanel(username, report) {
  const h1 = findProfileH1();
  if (!h1) {
    return;
  }

  const existing = document.getElementById("bon-profile-panel");
  const wasExpanded =
    existing
      ?.querySelector(".bon-profile-panel__body")
      ?.classList.contains("bon-profile-panel__body--expanded") ?? false;

  const fresh = bonPanelBuildProfilePanel(username, report, {
    expanded: wasExpanded,
    id: "bon-profile-panel",
  });
  if (existing && !isPanelMisplaced(existing)) {
    existing.replaceWith(fresh);
    return;
  }
  // Misplaced (e.g., Reddit reparented it inside a feed post) — drop the
  // stale node so the wrapper logic below re-anchors at the header.
  if (existing) {
    existing.remove();
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

function ensurePostAuthorPanel(username, postEl) {
  if (document.getElementById("bon-post-author-panel")) {
    return;
  }
  if (reportCache.has(username)) {
    renderPostAuthorPanel(username, postEl, reportCache.get(username));
  } else {
    void refreshPostAuthorPanel(username, postEl);
  }
}

async function refreshPostAuthorPanel(username, postEl) {
  const postMatch = window.location.pathname.match(
    /^\/r\/[^/]+\/comments\/[^/]+/i
  );
  if (!postMatch) {
    return;
  }
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
    void bonPanelFetchAndStoreCakeDay(username);
  }
}

function renderPostAuthorPanel(username, postEl, report) {
  // postEl may have been detached by Reddit's SPA re-render; re-resolve it
  if (!postEl || !postEl.isConnected) {
    postEl = document.querySelector("shreddit-post");
    if (!postEl) {
      return;
    }
  }

  const existing = document.getElementById("bon-post-author-panel");
  const wasExpanded =
    existing
      ?.querySelector(".bon-profile-panel__body")
      ?.classList.contains("bon-profile-panel__body--expanded") ?? false;

  const fresh = bonPanelBuildProfilePanel(username, report, {
    expanded: wasExpanded,
    id: "bon-post-author-panel",
  });

  // Only swap in place if the existing panel is still attached to the
  // correct post — otherwise it's stranded on a stale feed post and we
  // re-anchor via the credit-bar slot logic below.
  if (existing && existing.closest("shreddit-post") === postEl) {
    // Preserve slot assignment. `bonPanelBuildProfilePanel` doesn't know
    // about shreddit-post's named slots, so without copying slot="credit-bar"
    // here the fresh node falls into the unnamed slot and renders below
    // the post body.
    const slot = existing.getAttribute("slot");
    if (slot) {
      fresh.setAttribute("slot", slot);
    }
    existing.replaceWith(fresh);
    return;
  }
  if (existing) {
    existing.remove();
  }

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

export function bonProfilePanelInject() {
  injectProfilePanel();
  injectPostAuthorPanel();
}

export function bonProfilePanelInit() {
  bonProfilePanelInject();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.reports) {
      return;
    }
    const profilePanel = document.getElementById("bon-profile-panel");
    if (profilePanel?.dataset.username) {
      void refreshProfilePanel(profilePanel.dataset.username);
    }
    const postPanel = document.getElementById("bon-post-author-panel");
    if (postPanel?.dataset.username) {
      const postEl = document.querySelector("shreddit-post");
      void refreshPostAuthorPanel(postPanel.dataset.username, postEl);
    }
  });
}
