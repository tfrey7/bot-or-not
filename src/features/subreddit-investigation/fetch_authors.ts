// Background-side fetch of post authors from a subreddit's `/new` feed.
//
// Used by subredditAnalyze to source the per-sub author sample without
// depending on what the operator has scrolled into view. Goes through the
// shared Reddit client so a 429 surfaces with retryAfterMs the same way
// other Reddit fetches do — the caller's investigation queue then pauses
// on notBefore the same as if a user-listing endpoint had thrown.
//
// Walks Reddit's `after=` cursor until we have `target` unique authors
// (modulo excluded usernames like [deleted] / AutoModerator), or until
// we run out of pages, or until we hit MAX_AUTHOR_PAGES — whichever
// comes first. Each page costs one Reddit hit, so the page cap matters
// when a sub has unusually low author diversity per post (mostly the
// same few accounts replying to themselves, or AutoMod posts dominating
// /new).

import { redditFetchJson } from "../../reddit/client.ts";
import type { RedditListing } from "../../types.ts";

const AUTHOR_PAGE_LIMIT = 100;
const MAX_AUTHOR_PAGES = 5;

// Authors that don't represent a real account on the post-author axis:
// [deleted] is Reddit's tombstone for removed bylines, AutoModerator is
// a subreddit's own mod bot. Either polluting the sample with consistent
// "bot" verdicts would skew every sub toward compromised.
const EXCLUDED_AUTHORS = new Set(["[deleted]", "automoderator"]);

export interface SubredditAuthorFetchResult {
  authors: string[];
  pagesFetched: number;
  postsScanned: number;
}

export async function subredditFetchAuthors(
  name: string,
  target: number
): Promise<SubredditAuthorFetchResult> {
  const encoded = encodeURIComponent(name);
  const seen = new Set<string>();
  const authors: string[] = [];
  let cursor: string | null = null;
  let pagesFetched = 0;
  let postsScanned = 0;

  while (authors.length < target && pagesFetched < MAX_AUTHOR_PAGES) {
    const afterParam: string = cursor
      ? `&after=${encodeURIComponent(cursor)}`
      : "";
    const url: string = `https://www.reddit.com/r/${encoded}/new.json?limit=${AUTHOR_PAGE_LIMIT}${afterParam}&raw_json=1`;

    const page: RedditListing = await redditFetchJson<RedditListing>(url);
    pagesFetched += 1;

    const children = page.data?.children ?? [];
    postsScanned += children.length;

    for (const child of children) {
      const author = (
        child.data as { author?: string } | undefined
      )?.author?.trim();

      if (!author) {
        continue;
      }

      const lower = author.toLowerCase();
      if (EXCLUDED_AUTHORS.has(lower) || seen.has(lower)) {
        continue;
      }

      seen.add(lower);
      authors.push(author);

      if (authors.length >= target) {
        break;
      }
    }

    const nextCursor: string | null = page.data?.after ?? null;
    if (!nextCursor || children.length === 0) {
      break;
    }

    cursor = nextCursor;
  }

  return { authors, pagesFetched, postsScanned };
}
