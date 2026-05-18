// Passive scanning for state changes the user didn't have to report. While
// browsing Reddit we watch for: suspended/deleted accounts on profile pages,
// removed/deleted posts in feeds and on standalone post pages, and
// BotBouncer verdicts on r/BotBouncer posts. Each detection dispatches an
// update message to the background — dedup state below keeps us from
// re-sending the same observation per page load.

let lastUserStatusReported = null;
const reportedPostPermalinks = new Set();
const reportedBotBouncerKeys = new Set();

function detectUserStatus() {
  const profileMatch = window.location.pathname.match(
    /^\/(?:user|u)\/([^/?#]+)/i
  );
  if (!profileMatch) {
    return;
  }
  const username = profileMatch[1];
  const bodyText = document.body?.textContent || "";

  let status = null;
  if (/account has been suspended/i.test(bodyText)) {
    status = "suspended";
  } else if (/nobody on Reddit goes by that name/i.test(bodyText)) {
    status = "deleted";
  }

  if (!status) {
    return;
  }
  const key = `${username}#${status}`;
  if (lastUserStatusReported === key) {
    return;
  }
  lastUserStatusReported = key;
  browser.runtime.sendMessage({
    type: "update-user-status",
    username,
    status,
  });
}

function reportPostStatus(permalink, status) {
  if (!permalink || !status) {
    return;
  }
  if (reportedPostPermalinks.has(permalink)) {
    return;
  }
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
    if (!permalink) {
      return;
    }
    const removedBy = post.getAttribute("removed-by-category");
    const author = post.getAttribute("author");
    let status = null;
    if (removedBy && removedBy !== "" && removedBy !== "none") {
      status = "removed";
    } else if (author === "[deleted]") {
      status = "deleted";
    }
    if (status) {
      reportPostStatus(permalink, status);
    }
  });
}

function detectStandalonePostStatus() {
  const m = window.location.pathname.match(
    /^(\/r\/[^/]+\/comments\/[^/]+\/[^/?#]+\/?)/i
  );
  if (!m) {
    return;
  }
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
  if (status) {
    reportPostStatus(permalink, status);
  }
}

function detectBotBouncerStatuses() {
  document.querySelectorAll("shreddit-post").forEach((post) => {
    const subreddit = (
      post.getAttribute("subreddit-prefixed-name") ||
      post.getAttribute("subreddit-name") ||
      ""
    ).toLowerCase();
    if (!/(^|\/)botbouncer$/.test(subreddit)) {
      return;
    }

    const title = post.getAttribute("post-title") || "";
    const titleMatch = title.match(/^Overview for (\S+)/);
    if (!titleMatch) {
      return;
    }
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
    if (!status) {
      return;
    }

    const key = `${username.toLowerCase()}#${status}`;
    if (reportedBotBouncerKeys.has(key)) {
      return;
    }
    reportedBotBouncerKeys.add(key);

    browser.runtime.sendMessage({
      type: "update-botbouncer-status",
      username,
      status,
    });
  });
}

export function bonStatusDetectionScan() {
  detectUserStatus();
  detectPostStatuses();
  detectStandalonePostStatus();
  detectBotBouncerStatuses();
}

export function bonStatusDetectionInit() {
  bonStatusDetectionScan();
}

export function bonStatusDetectionResetNav() {
  lastUserStatusReported = null;
  reportedPostPermalinks.clear();
  reportedBotBouncerKeys.clear();
}
