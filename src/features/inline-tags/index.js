// Inline username pills rendered next to every reddit /user/ link in feeds
// and comments. `bonInlineTagsInit` does the first-time wiring (load tags,
// install click + storage listeners); the orchestrator calls
// `bonInlineTagsMark` on every MutationObserver tick to tag freshly-rendered
// links.

import { bonCssEscape } from "../../utils/format_text.js";
import {
  bonInlineTagIsAvatarLink,
  bonInlineTagLabel,
  bonInlineTagTitle,
  bonInlineTagVariant,
} from "./logic.js";

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

function buildUserTag(info) {
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

export function bonInlineTagsMark() {
  if (!tagsLoaded) {
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
      if (bonInlineTagIsAvatarLink(el)) {
        return;
      }
      const info = userTags.get(match[1].toLowerCase());
      if (!info) {
        return;
      }
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
          `.bon-user-tag[data-bon-tag-for="${bonCssEscape(key)}"]`
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
    .querySelectorAll(`.bon-user-tag[data-bon-tag-for="${bonCssEscape(key)}"]`)
    .forEach((t) => t.remove());
  document
    .querySelectorAll('a[href*="/user/"], a[href*="/u/"]')
    .forEach((el) => {
      const href = el.getAttribute("href");
      const match = href.match(/\/(?:user|u)\/([^/?#]+)/i);
      if (!match || match[1].toLowerCase() !== key) {
        return;
      }
      delete el.dataset.bonMarked;
    });
  bonInlineTagsMark();
}

function resetAndMarkAll() {
  document.querySelectorAll(".bon-user-tag").forEach((t) => t.remove());
  document
    .querySelectorAll("a[data-bon-marked]")
    .forEach((el) => delete el.dataset.bonMarked);
  bonInlineTagsMark();
}

// Optimistic bump used by the reporting feature: when the user submits a
// report, we want the pill to update immediately without waiting for the
// background to round-trip a fresh tag map.
export function bonInlineTagsBumpReport(username) {
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

export function bonInlineTagsInit() {
  void loadUserTags();

  document.addEventListener(
    "click",
    (e) => {
      const tag = e.target?.closest?.(".bon-user-tag");
      if (!tag) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      browser.runtime.sendMessage({ type: "open-popup" });
    },
    true
  );

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.reports) {
      return;
    }
    void loadUserTags();
  });
}
