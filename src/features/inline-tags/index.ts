// Inline username pills rendered next to every reddit /user/ link in feeds
// and comments. `bonInlineTagsInit` does the first-time wiring (load tags,
// install click + storage listeners); the orchestrator calls
// `bonInlineTagsMark` on every MutationObserver tick to tag freshly-rendered
// links.

import { bonCssEscape } from "../../utils/format_text.ts";
import { bonRingChip } from "../../utils/ring_chip.ts";
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

async function loadUserTags(): Promise<void> {
  const { tags = {} } = (await browser.runtime.sendMessage({
    type: "get-user-tags",
  })) as { tags?: Record<string, UserTagInfo> };

  userTags = new Map();
  for (const [username, info] of Object.entries(tags)) {
    userTags.set(username.toLowerCase(), { ...info, username });
  }

  tagsLoaded = true;
  resetAndMarkAll();
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

export function bonInlineTagsMark(): void {
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

      anchor.dataset.bonMarked = "true";

      if (bonInlineTagIsAvatarLink(anchor)) {
        return;
      }

      const info = userTags.get(match[1].toLowerCase());
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

export function bonInlineTagsInit(): void {
  void loadUserTags();

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const tag = target?.closest?.(".bon-user-tag");
      if (!tag) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
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
