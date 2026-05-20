// Turns the raw SERP scrape into a shape an investigation prompt could
// actually consume: per-post {subreddit, kind, age, …} plus subreddit /
// kind aggregates. Pure — no network, no DOM, no storage.
//
// Reddit URL kinds we care about:
//   /user/<u>                              → profile-root
//   /user/<u>/comments/<id>/<slug>         → profile-post (user-posted on their own profile)
//   /r/<sub>/comments/<id>/<slug>          → sub-post
//   /r/<sub>/comments/<id>/<slug>/<cid>    → comment (permalink to a comment thread)
//   /r/<sub>(/(new|hot|top|...))?          → subreddit
//   everything else                        → other

import type { GoogleHarvestPost, GoogleHarvestPostKind } from "../../types.ts";
import type { BonGoogleResult } from "./scrape.ts";

// Pre-merge post shape. Identical to GoogleHarvestPost minus the
// firstSeenAt/lastSeenAt timestamps — the parser is pure and doesn't know
// about clock time. Those timestamps are stamped by the persistence-side
// merge in bonGoogleHarvestMerge.
export type BonScrapedPost = Omit<
  GoogleHarvestPost,
  "firstSeenAt" | "lastSeenAt"
>;

// Returns the harvest minus the envelope timestamps + query — those are
// added by the content script entry / merge layer.
export interface BonParsedHarvest {
  posts: BonScrapedPost[];
  subredditDistribution: Record<string, number>;
  kinds: Record<GoogleHarvestPostKind, number>;
}

// `/(\d+)\s+(year|month|week|day|hour|minute)s?\s+ago/i` — Google emits these
// in the result chrome ("Reddit · r/DailyGuess · 4 months ago"). Captures the
// most-recent relative-time mention in the snippet.
const AGE_RE = /(\d+\s+(?:year|month|week|day|hour|minute)s?\s+ago)/i;

// Same chrome usually carries comment counts like "4 comments" or "30+
// comments". Capture the number; the "+" is informational so we drop it.
const COMMENTS_RE = /(\d+)\+?\s+comments?/i;

function classify(url: string): {
  kind: GoogleHarvestPostKind;
  subreddit: string | null;
  postId: string | null;
  slug: string | null;
} {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return { kind: "other", subreddit: null, postId: null, slug: null };
  }

  const profilePost = path.match(
    /^\/user\/([^/]+)\/comments\/([^/]+)(?:\/([^/]+))?/i
  );

  if (profilePost) {
    return {
      kind: "profile-post",
      subreddit: null,
      postId: profilePost[2],
      slug: profilePost[3] ?? null,
    };
  }

  const profileRoot = path.match(/^\/user\/([^/]+)\/?$/i);
  if (profileRoot) {
    return { kind: "profile-root", subreddit: null, postId: null, slug: null };
  }

  // /r/<sub>/comments/<id>/<slug>(/<comment_id>)?
  const subPost = path.match(
    /^\/r\/([^/]+)\/comments\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?/i
  );

  if (subPost) {
    const hasCommentId = !!subPost[4];
    return {
      kind: hasCommentId ? "comment" : "sub-post",
      subreddit: subPost[1],
      postId: subPost[2],
      slug: subPost[3] ?? null,
    };
  }

  // /r/<sub> with an optional sort tab (/new, /hot, /top, /rising,
  // /controversial). Google often returns the sort-tab listing when the
  // user's content is prominent there, so we treat it as a subreddit hit.
  const subRoot = path.match(
    /^\/r\/([^/]+)(?:\/(?:new|hot|top|rising|controversial))?\/?$/i
  );

  if (subRoot) {
    return {
      kind: "subreddit",
      subreddit: subRoot[1],
      postId: null,
      slug: null,
    };
  }

  return { kind: "other", subreddit: null, postId: null, slug: null };
}

function extractAgeHint(snippet: string): string | null {
  const match = snippet.match(AGE_RE);
  return match ? match[1].trim() : null;
}

function extractCommentCount(snippet: string): number | null {
  const match = snippet.match(COMMENTS_RE);
  if (!match) {
    return null;
  }

  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function bonGoogleHarvestParse(
  results: BonGoogleResult[]
): BonParsedHarvest {
  const posts: BonScrapedPost[] = results.map((result) => {
    const classification = classify(result.url);

    return {
      url: result.url,
      kind: classification.kind,
      subreddit: classification.subreddit,
      postId: classification.postId,
      slug: classification.slug,
      title: result.title,
      ageHint: extractAgeHint(result.snippet),
      commentCountHint: extractCommentCount(result.snippet),
      snippetText: result.snippet,
    };
  });

  // Reddit subreddit names are case-insensitive but each has a canonical
  // display casing. Google sometimes renders the same sub two different
  // ways across results ("YUROP" vs "yurop"). Lock in the first casing we
  // see for each sub, then use it as the key everywhere downstream so
  // posts[].subreddit and subredditDistribution agree.
  const canonical: Record<string, string> = {};

  for (const post of posts) {
    if (post.subreddit) {
      const lower = post.subreddit.toLowerCase();
      if (!canonical[lower]) {
        canonical[lower] = post.subreddit;
      }

      post.subreddit = canonical[lower];
    }
  }

  const subredditDistribution: Record<string, number> = {};
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
    }
  }

  return { posts, subredditDistribution, kinds };
}
