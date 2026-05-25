// DOM walker that finds posts / comments authored by hidden-profile users
// on the page the operator is currently browsing. Targets both Reddit's
// new shreddit-* web components and old.reddit.com's `.thing` markup so
// the harvester works across the surfaces the content script runs on.
//
// The scraper is deliberately self-attributing: it only emits an item
// when the surrounding element's `author` / `data-author` attribute
// matches one of the hidden usernames the caller passes in. The
// permalink on the same element identifies the item canonically, which
// is what the merge layer uses to dedup across captures.

import type {
  PassiveHarvestItem,
  PassiveHarvestItemKind,
} from "../../types.ts";

export interface PassiveHarvestFinding {
  username: string;

  // Pre-merge item shape — same as PassiveHarvestItem minus the
  // firstSeenAt / lastSeenAt timestamps, which the merge layer stamps
  // with its own clock so two captures from the same browser tab can't
  // disagree on wall time.
  item: Omit<PassiveHarvestItem, "firstSeenAt" | "lastSeenAt">;
}

const BODY_EXCERPT_MAX = 500;

function readCreatedAt(el: HTMLElement): number | null {
  const isoAttr =
    el.getAttribute("created-timestamp") || el.getAttribute("created-utc");

  if (isoAttr) {
    const ms = Number(isoAttr);
    if (Number.isFinite(ms) && ms > 0) {
      return ms < 1e12 ? ms * 1000 : ms;
    }

    const parsed = Date.parse(isoAttr);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const time = el.querySelector<HTMLTimeElement>("time[datetime]");
  if (time) {
    const parsed = Date.parse(time.getAttribute("datetime") || "");
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const timeago = el.querySelector<HTMLElement>("faceplate-timeago[ts]");
  if (timeago) {
    const parsed = Date.parse(timeago.getAttribute("ts") || "");
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, BODY_EXCERPT_MAX);
}

function extractShreddit(
  el: HTMLElement
): PassiveHarvestFinding["item"] | null {
  const permalink = el.getAttribute("permalink");
  if (!permalink) {
    return null;
  }

  const tag = el.tagName.toLowerCase();
  const kind: PassiveHarvestItemKind =
    tag === "shreddit-post" ? "post" : "comment";
  const subreddit =
    el.getAttribute("subreddit-prefixed-name") ||
    (el.getAttribute("subreddit-name")
      ? `r/${el.getAttribute("subreddit-name")}`
      : null);

  const postTitle =
    kind === "post" ? el.getAttribute("post-title") || null : null;

  // Post: selftext lives in [slot="text-body"]. Comment: body lives in
  // [slot="comment"]. Both occasionally null (link posts, deleted
  // comments) — keep going with an empty excerpt so the permalink + sub
  // alone are still recorded.
  const bodyHost =
    kind === "post"
      ? el.querySelector<HTMLElement>('[slot="text-body"]')
      : el.querySelector<HTMLElement>('[slot="comment"]');
  const bodyExcerpt = clip(bodyHost?.textContent || "");

  return {
    kind,
    permalink,
    subreddit,
    postTitle,
    bodyExcerpt,
    createdAt: readCreatedAt(el),
  };
}

function extractOldReddit(
  el: HTMLElement
): PassiveHarvestFinding["item"] | null {
  const permalink = el.getAttribute("data-permalink");
  if (!permalink) {
    return null;
  }

  const isComment = el.classList.contains("comment");
  const kind: PassiveHarvestItemKind = isComment ? "comment" : "post";
  const subreddit = el.getAttribute("data-subreddit");
  const subredditPrefixed = subreddit ? `r/${subreddit}` : null;

  let bodyHost: HTMLElement | null;
  let postTitle: string | null = null;

  if (isComment) {
    bodyHost = el.querySelector<HTMLElement>(".md");
  } else {
    bodyHost = el.querySelector<HTMLElement>(".usertext-body .md");
    postTitle =
      el.querySelector<HTMLElement>("a.title")?.textContent?.trim() || null;
  }

  return {
    kind,
    permalink,
    subreddit: subredditPrefixed,
    postTitle,
    bodyExcerpt: clip(bodyHost?.textContent || ""),
    createdAt: readCreatedAt(el),
  };
}

// Walks the DOM once and returns every fresh post/comment authored by a
// hidden-profile username. Elements are marked with `data-bon-harvested`
// the first time they're touched so subsequent ticks skip them — even
// when the author doesn't match, since re-checking the same element
// across hundreds of mutation-observer ticks isn't free on big threads.
//
// `hiddenUsernames` is the lowercased set of usernames the caller cares
// about. The caller is responsible for keeping it in sync with
// background storage (via `storage.onChanged` on the `reports` key).
export function passiveHarvestScrape(
  hiddenUsernames: Set<string>,
  doc: Document = document
): PassiveHarvestFinding[] {
  if (hiddenUsernames.size === 0) {
    return [];
  }

  const found: PassiveHarvestFinding[] = [];

  const shredditNodes = doc.querySelectorAll<HTMLElement>(
    "shreddit-post[author]:not([data-bon-harvested]), shreddit-comment[author]:not([data-bon-harvested])"
  );

  for (const el of shredditNodes) {
    el.dataset.bonHarvested = "1";

    const author = el.getAttribute("author");
    if (!author) {
      continue;
    }

    const usernameLower = author.toLowerCase();
    if (!hiddenUsernames.has(usernameLower)) {
      continue;
    }

    const item = extractShreddit(el);
    if (item) {
      found.push({ username: author, item });
    }
  }

  const oldNodes = doc.querySelectorAll<HTMLElement>(
    ".thing[data-author]:not([data-bon-harvested])"
  );

  for (const el of oldNodes) {
    el.dataset.bonHarvested = "1";

    const author = el.getAttribute("data-author");
    if (!author) {
      continue;
    }

    const usernameLower = author.toLowerCase();
    if (!hiddenUsernames.has(usernameLower)) {
      continue;
    }

    const item = extractOldReddit(el);
    if (item) {
      found.push({ username: author, item });
    }
  }

  return found;
}
