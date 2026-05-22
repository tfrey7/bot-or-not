// Inline username pills rendered next to every reddit /user/ link in feeds
// and comments, plus a chip in the profile-page header that opens the same
// flyout. `bonInlineTagsInit` does the first-time wiring (load tags, install
// click + storage listeners); the orchestrator calls `bonInlineTagsMark` on
// every MutationObserver tick to tag freshly-rendered links and to keep the
// profile-header chip in sync.

import { bonClientSend, bonClientSubscribe } from "../../client.ts";
import { bonCssEscape } from "../../utils/format_text.ts";
import { bonRingChip } from "../../utils/ring_chip.ts";
import { bonInlineTagsCloseFlyout, bonInlineTagsOpenFlyout } from "./flyout.ts";
import {
  bonInlineTagIsAvatarLink,
  bonInlineTagLabel,
  bonInlineTagTitle,
  bonInlineTagVariant,
  type UserTagInfo,
} from "./logic.ts";

// Keyed by lowercase username so lookups match Reddit's case-insensitive
// routing (a link can use any casing for the same account).
let userTags = new Map<string, UserTagInfo>();
let tagsLoaded = false;

// Last profile username we kicked off an auto-investigation for. Guards the
// chip-injection loop (runs on every observer tick) from re-firing the IPC
// per tick once the chip is in place.
let lastProfileAutoInvestigate: string | null = null;

async function loadUserTags(): Promise<void> {
  const { tags = {} } = await bonClientSend<{
    tags?: Record<string, UserTagInfo>;
  }>({
    type: "get-user-tags",
  });

  const nextTags = new Map<string, UserTagInfo>();

  for (const [username, info] of Object.entries(tags)) {
    nextTags.set(username.toLowerCase(), { ...info, username });
  }

  // First load: nothing on the page is tagged yet, so mark everything.
  if (!tagsLoaded) {
    userTags = nextTags;
    tagsLoaded = true;
    resetAndMarkAll();
    return;
  }

  // Subsequent loads (storage.onChanged): only refresh tags whose
  // tag-affecting fields actually changed. Reports get written constantly
  // for reasons that don't touch how a tag looks (Google attribution
  // backfill, passive harvest captures, etc) — nuke-and-rebuild on every
  // write tears down whatever pill the operator is hovering or clicking.
  const previousTags = userTags;
  userTags = nextTags;

  const changedKeys = new Set<string>();

  for (const [key, info] of nextTags) {
    const before = previousTags.get(key);
    if (!before || !sameTagInfo(before, info)) {
      changedKeys.add(key);
    }
  }

  for (const key of previousTags.keys()) {
    if (!nextTags.has(key)) {
      changedKeys.add(key);
    }
  }

  for (const key of changedKeys) {
    refreshUserTag(key);
  }
}

function sameTagInfo(a: UserTagInfo, b: UserTagInfo): boolean {
  return (
    a.count === b.count &&
    (a.verdict ?? null) === (b.verdict ?? null) &&
    (a.confidence ?? null) === (b.confidence ?? null) &&
    (a.investigationStatus ?? null) === (b.investigationStatus ?? null) &&
    (a.botBouncerStatus ?? null) === (b.botBouncerStatus ?? null) &&
    (a.userStatus ?? null) === (b.userStatus ?? null) &&
    (a.ringId ?? null) === (b.ringId ?? null)
  );
}

function buildUserTag(info: UserTagInfo): HTMLSpanElement {
  const variant = bonInlineTagVariant(info);
  const tag = document.createElement("span");

  tag.className = `bon-user-tag bon-user-tag--${variant}`;
  tag.dataset.bonTagFor = info.username.toLowerCase();
  tag.setAttribute("role", "button");
  tag.setAttribute("tabindex", "0");
  tag.title = bonInlineTagTitle(info, variant);
  tag.textContent = bonInlineTagLabel(info, variant);
  return tag;
}

// True when the anchor is the author byline link of the active
// shreddit-post on a /r/*/comments/* page (i.e. the OP of the post the
// user is currently viewing, not a feed item). The "credit-bar" slot on
// shreddit-post wraps the byline; the active post is the one whose
// permalink matches the URL and isn't nested in a feed.
function isPostAuthorByline(anchor: HTMLAnchorElement): boolean {
  if (!/^\/r\/[^/]+\/comments\//i.test(window.location.pathname)) {
    return false;
  }

  const post = anchor.closest("shreddit-post") as HTMLElement | null;
  if (!post || post.closest("shreddit-feed")) {
    return false;
  }

  const permalink = (post.getAttribute("permalink") || "")
    .toLowerCase()
    .split("?")[0];

  if (
    !permalink ||
    !window.location.pathname.toLowerCase().startsWith(permalink)
  ) {
    return false;
  }

  return !!anchor.closest('[slot="credit-bar"]');
}

// Walks the document for the profile-page header h1 (avatar + username row),
// not a post/comment title h1 in the feed below it. Mirrors the heuristic the
// old embedded profile-panel used.
function findProfileHeaderH1(): HTMLHeadingElement | null {
  for (const h1 of document.querySelectorAll("h1")) {
    if (h1.closest("shreddit-post, shreddit-comment, article")) {
      continue;
    }

    return h1 as HTMLHeadingElement;
  }

  return null;
}

// On /user/* pages, inject a clickable chip into the profile header so the
// page surfaces the same flyout as the inline pills. Idempotent: rebuilds the
// chip only when the variant or label changes, so the per-tick call is cheap.
function markProfileHeader(): void {
  const profileMatch = window.location.pathname.match(
    /^\/(?:user|u)\/([^/?#]+)/i
  );

  if (!profileMatch) {
    document.getElementById("bon-profile-chip")?.remove();
    lastProfileAutoInvestigate = null;
    return;
  }

  const username = profileMatch[1];
  const key = username.toLowerCase();

  const h1 = findProfileHeaderH1();
  if (!h1) {
    return;
  }

  const info: UserTagInfo = userTags.get(key) || {
    username,
    count: 0,
    verdict: null,
    confidence: null,
    investigationStatus: null,
    investigationStartedAt: null,
    botBouncerStatus: null,
    userStatus: null,
  };

  const variant = bonInlineTagVariant(info);
  const label = bonInlineTagLabel(info, variant);

  const existing = document.getElementById(
    "bon-profile-chip"
  ) as HTMLElement | null;

  const upToDate =
    !!existing &&
    existing.dataset.bonTagFor === key &&
    existing.classList.contains(`bon-user-tag--${variant}`) &&
    existing.textContent === label &&
    existing.isConnected &&
    existing.parentElement === h1;

  if (!upToDate) {
    existing?.remove();
    const chip = buildUserTag(info);
    chip.id = "bon-profile-chip";
    h1.appendChild(chip);
  }

  if (lastProfileAutoInvestigate !== key) {
    lastProfileAutoInvestigate = key;
    void bonClientSend({
      type: "auto-investigate-on-view",
      username,
    });
  }
}

export function bonInlineTagsMark(): void {
  markProfileHeader();

  if (!tagsLoaded) {
    return;
  }

  document
    .querySelectorAll<HTMLAnchorElement>(
      'a[href*="/user/"]:not([data-bon-marked]), a[href*="/u/"]:not([data-bon-marked])'
    )
    .forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) {
        return;
      }

      const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
      if (!match) {
        return;
      }

      if (anchor.closest('[id^="profile-tab"]')) {
        return;
      }

      // On a post detail page, hold off marking until the enclosing
      // shreddit-post has its `permalink` attribute set — that's what
      // identifies the OP byline. Without this guard, a tick that runs
      // between mount and attribute-settle would mark the anchor for
      // good and we'd never get a chance to inject the idle tag.
      if (/^\/r\/[^/]+\/comments\//i.test(window.location.pathname)) {
        const enclosingPost = anchor.closest(
          "shreddit-post"
        ) as HTMLElement | null;

        if (enclosingPost && !enclosingPost.getAttribute("permalink")) {
          return;
        }
      }

      anchor.dataset.bonMarked = "true";

      if (bonInlineTagIsAvatarLink(anchor)) {
        return;
      }

      // /user/ links inside a shreddit-post but outside the byline are
      // post-body content (inline mentions, link-preview cards for a
      // profile URL). The only anchor per post we ever want to tag is
      // the author byline in [slot="credit-bar"].
      const enclosingPost = anchor.closest("shreddit-post");
      if (enclosingPost && !anchor.closest('[slot="credit-bar"]')) {
        return;
      }

      let info = userTags.get(match[1].toLowerCase());
      if (!info && isPostAuthorByline(anchor)) {
        // Synthetic idle info: produces the "Bot?" tag so post OPs are
        // always one click away from an investigation, even when we have
        // no prior reports or analysis for them.
        info = {
          username: match[1],
          count: 0,
          verdict: null,
          confidence: null,
          investigationStatus: null,
          investigationStartedAt: null,
          botBouncerStatus: null,
          userStatus: null,
        };
      }

      if (!info) {
        return;
      }

      const key = match[1].toLowerCase();

      // Skip if a tag for this user already sits next to this link (Reddit
      // sometimes re-parents anchors, dropping the data-bon-marked flag).
      const sibling = anchor.nextElementSibling as HTMLElement | null;
      if (
        sibling?.classList?.contains("bon-user-tag") &&
        sibling.dataset.bonTagFor === key
      ) {
        return;
      }

      // Scoped dedup: post headers often contain multiple anchors for the
      // same user (avatar + username link). Only one pill per header.
      const scope =
        anchor.closest("shreddit-post, shreddit-comment, article, header") ||
        anchor.parentElement;

      if (
        scope?.querySelector(
          `.bon-user-tag[data-bon-tag-for="${bonCssEscape(key)}"]`
        )
      ) {
        return;
      }

      const tag = buildUserTag(info);
      anchor.insertAdjacentElement("afterend", tag);

      const ringChip = bonRingChip(info.ringId ?? null);
      if (ringChip) {
        tag.insertAdjacentElement("afterend", ringChip);
      }
    });
}

function refreshUserTag(username: string): void {
  const key = username.toLowerCase();

  document
    .querySelectorAll(`.bon-user-tag[data-bon-tag-for="${bonCssEscape(key)}"]`)
    .forEach((tag) => {
      const next = tag.nextElementSibling;
      if (next?.classList.contains("bon-ring-chip")) {
        next.remove();
      }

      tag.remove();
    });

  document
    .querySelectorAll<HTMLAnchorElement>('a[href*="/user/"], a[href*="/u/"]')
    .forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) {
        return;
      }

      const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
      if (!match || match[1].toLowerCase() !== key) {
        return;
      }

      delete anchor.dataset.bonMarked;
    });

  bonInlineTagsMark();
}

function resetAndMarkAll(): void {
  document.querySelectorAll(".bon-user-tag").forEach((tag) => tag.remove());
  document.querySelectorAll(".bon-ring-chip").forEach((chip) => chip.remove());
  document
    .querySelectorAll<HTMLAnchorElement>("a[data-bon-marked]")
    .forEach((anchor) => delete anchor.dataset.bonMarked);
  bonInlineTagsMark();
}

// Optimistic bump used by the reporting feature: when the user submits a
// report, we want the pill to update immediately without waiting for the
// background to round-trip a fresh tag map.
export function bonInlineTagsBumpReport(username: string): void {
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
}

// Called by the content-script orchestrator on SPA navigation. Closes any
// open flyout so a stale assessment doesn't hover on screen after the
// user moves to a different post or feed.
export function bonInlineTagsResetNav(): void {
  bonInlineTagsCloseFlyout();
}

export function bonInlineTagsInit(): void {
  void loadUserTags();

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const tag = target?.closest?.(".bon-user-tag") as HTMLElement | null;
      if (!tag) {
        return;
      }

      const username = tag.dataset.bonTagFor;
      if (!username) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      bonInlineTagsOpenFlyout(username, tag);
    },
    true
  );

  bonClientSubscribe((event) => {
    if (event.type === "reports-changed") {
      void loadUserTags();
    }
  });
}
