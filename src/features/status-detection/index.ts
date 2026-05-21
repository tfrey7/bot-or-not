// Passive scanning for state changes the user didn't have to report. While
// browsing Reddit we watch for: suspended/deleted accounts on profile pages,
// removed/deleted posts in feeds and on standalone post pages, and
// BotBouncer verdicts on r/BotBouncer posts. Each detection dispatches an
// update message to the background — dedup state below keeps us from
// re-sending the same observation per page load.

import { bonClientSend } from "../../client.ts";

let lastUserStatusReported: string | null = null;
const reportedPostPermalinks = new Set<string>();
const reportedBotBouncerKeys = new Set<string>();

// document.body.textContent scans are O(body size). On big comment threads
// the body can be multiple MB, and the orchestrator fires us once per
// animation frame — so we throttle the textContent-backed detectors to one
// scan per second. The detected message may not be in the DOM on the first
// scan, so we can't go "once and done" — but per-second is cheap and still
// catches late renders within the page lifetime. resetNav() resets these
// on SPA navigation.
const STATUS_SCAN_THROTTLE_MS = 1000;
let lastUserStatusScanAt = 0;
let lastStandalonePostScanAt = 0;

function detectUserStatus(): void {
  const profileMatch = window.location.pathname.match(
    /^\/(?:user|u)\/([^/?#]+)/i
  );

  if (!profileMatch) {
    return;
  }

  const now = Date.now();
  if (now - lastUserStatusScanAt < STATUS_SCAN_THROTTLE_MS) {
    return;
  }

  lastUserStatusScanAt = now;

  const username = profileMatch[1];
  const bodyText = document.body?.textContent || "";

  let status: "suspended" | "deleted" | null = null;
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
  void bonClientSend({
    type: "update-user-status",
    username,
    status,
  });
}

function reportPostStatus(
  permalink: string | null,
  status: string | null
): void {
  if (!permalink || !status) {
    return;
  }

  if (reportedPostPermalinks.has(permalink)) {
    return;
  }

  reportedPostPermalinks.add(permalink);
  void bonClientSend({
    type: "update-post-status",
    permalink,
    status,
  });
}

function detectPostStatuses(): void {
  document.querySelectorAll("shreddit-post").forEach((post) => {
    const permalink = post.getAttribute("permalink");
    if (!permalink) {
      return;
    }

    const removedBy = post.getAttribute("removed-by-category");
    const author = post.getAttribute("author");

    let status: string | null = null;
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

function detectStandalonePostStatus(): void {
  const match = window.location.pathname.match(
    /^(\/r\/[^/]+\/comments\/[^/]+\/[^/?#]+\/?)/i
  );

  if (!match) {
    return;
  }

  const permalink = match[1].endsWith("/") ? match[1] : `${match[1]}/`;
  if (reportedPostPermalinks.has(permalink)) {
    return;
  }

  const now = Date.now();
  if (now - lastStandalonePostScanAt < STATUS_SCAN_THROTTLE_MS) {
    return;
  }

  lastStandalonePostScanAt = now;

  const bodyText = document.body?.textContent || "";

  let status: string | null = null;
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

function detectBotBouncerStatuses(): void {
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
      const flairElement = post.querySelector(
        "shreddit-post-flair, [class*='flair']"
      );
      flairText = flairElement?.textContent?.trim().toLowerCase() || "";
    }

    const status = ["banned", "pending", "organic"].find(
      (candidate) => candidate === flairText
    );

    if (!status) {
      return;
    }

    const key = `${username.toLowerCase()}#${status}`;
    if (reportedBotBouncerKeys.has(key)) {
      return;
    }

    reportedBotBouncerKeys.add(key);

    void bonClientSend({
      type: "update-botbouncer-status",
      username,
      status,
    });
  });
}

export function bonStatusDetectionScan(): void {
  detectUserStatus();
  detectPostStatuses();
  detectStandalonePostStatus();
  detectBotBouncerStatuses();
}

export function bonStatusDetectionInit(): void {
  bonStatusDetectionScan();
}

export function bonStatusDetectionResetNav(): void {
  lastUserStatusReported = null;
  reportedPostPermalinks.clear();
  reportedBotBouncerKeys.clear();
  lastUserStatusScanAt = 0;
  lastStandalonePostScanAt = 0;
}
