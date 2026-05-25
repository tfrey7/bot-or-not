// Pure merge function. Takes the prior persisted GoogleHarvest (or null on
// first capture) plus a fresh batch of scraped posts and returns the merged
// GoogleHarvest. Posts are unioned by canonical URL: an incoming URL we've
// seen keeps its original firstSeenAt and refreshes lastSeenAt + the
// mutable fields (title/snippet/ageHint/etc.) since Google may have
// updated them.
//
// No I/O — caller (the reports handler) is responsible for the read/write.

import type {
  GoogleHarvest,
  GoogleHarvestPost,
  GoogleHarvestPostKind,
} from "../../types.ts";
import type { ScrapedPost } from "./parse.ts";

// Strips trailing slashes + tracking fragments so two surface forms of the
// same Reddit post (e.g. `?context=3` or `?utm_…`) collapse to one entry.
function canonicalizeUrl(url: string): string {
  return url.split("#")[0].split("?")[0].replace(/\/$/, "");
}

function mergePost(
  existing: GoogleHarvestPost | undefined,
  incoming: ScrapedPost,
  now: number
): GoogleHarvestPost {
  if (existing) {
    // Refresh fields Google might have updated. firstSeenAt stays put.
    // Attribution fields also stay put — once the worker has resolved a
    // post, a re-scrape of the same URL shouldn't reset it. The exception
    // is profile-* kinds, where the URL itself proves authorship; if the
    // existing record somehow has a different value, take the URL-derived
    // one (cheap and correct).
    const incomingIsProfile =
      incoming.kind === "profile-root" || incoming.kind === "profile-post";
    const attribution = incomingIsProfile ? "authored" : existing.attribution;
    const attributionCheckedAt = incomingIsProfile
      ? (existing.attributionCheckedAt ?? now)
      : existing.attributionCheckedAt;

    return {
      ...existing,
      kind: incoming.kind,
      subreddit: incoming.subreddit,
      postId: incoming.postId,
      slug: incoming.slug,
      title: incoming.title,
      ageHint: incoming.ageHint,
      commentCountHint: incoming.commentCountHint,
      snippetText: incoming.snippetText,
      lastSeenAt: now,
      attribution,
      attributionCheckedAt,
    };
  }

  // New record. Pre-settle the kinds that don't need a Reddit fetch:
  // profile-* are self-attributing (URL contains the username), and
  // subreddit / other URLs have no single author to check. Only sub-post
  // and comment need to enter the attribution queue.
  const needsFetch =
    incoming.kind === "sub-post" || incoming.kind === "comment";

  return {
    ...incoming,
    firstSeenAt: now,
    lastSeenAt: now,
    attributionCheckedAt: needsFetch ? null : now,
  };
}

function computeAggregates(posts: GoogleHarvestPost[]): {
  subredditDistribution: Record<string, number>;
  authoredSubredditDistribution: Record<string, number>;
  kinds: Record<GoogleHarvestPostKind, number>;
} {
  const subredditDistribution: Record<string, number> = {};
  const authoredSubredditDistribution: Record<string, number> = {};
  const kinds: Record<GoogleHarvestPostKind, number> = {
    "profile-root": 0,
    "profile-post": 0,
    "sub-post": 0,
    comment: 0,
    subreddit: 0,
    other: 0,
  };

  for (const post of posts) {
    kinds[post.kind] += 1;
    if (post.subreddit) {
      subredditDistribution[post.subreddit] =
        (subredditDistribution[post.subreddit] || 0) + 1;

      if (post.attribution === "authored") {
        authoredSubredditDistribution[post.subreddit] =
          (authoredSubredditDistribution[post.subreddit] || 0) + 1;
      }
    }
  }

  return { subredditDistribution, authoredSubredditDistribution, kinds };
}

export interface HarvestMergeInput {
  existing: GoogleHarvest | null;
  incomingPosts: ScrapedPost[];
  query: string;
  now: number;
}

export function googleHarvestMerge(input: HarvestMergeInput): GoogleHarvest {
  const { existing, incomingPosts, query, now } = input;

  // Index existing posts by canonical URL so each incoming post finds its
  // prior version (if any) in O(1).
  const byUrl = new Map<string, GoogleHarvestPost>();

  for (const post of existing?.posts ?? []) {
    byUrl.set(canonicalizeUrl(post.url), post);
  }

  for (const incoming of incomingPosts) {
    const key = canonicalizeUrl(incoming.url);
    byUrl.set(key, mergePost(byUrl.get(key), incoming, now));
  }

  const posts = Array.from(byUrl.values());
  const aggregates = computeAggregates(posts);

  return {
    firstCapturedAt: existing?.firstCapturedAt ?? now,
    lastCapturedAt: now,
    captureCount: (existing?.captureCount ?? 0) + 1,
    query,
    posts,
    ...aggregates,
  };
}
