// Pure transform: raw Reddit JSON → activity summary used by the analyzer
// and the heatmap.

import { bonScanTextSignals } from "../features/regions/index.ts";
import type { ActivityData, RedditActivityFetch } from "../types.ts";

const BON_REDDIT_FETCH_LIMIT = 100;

interface RedditPost {
  subreddit?: string;
  subreddit_name_prefixed?: string;
  created_utc?: number;
  title?: string;
  selftext?: string;
}
interface RedditComment {
  subreddit?: string;
  subreddit_name_prefixed?: string;
  created_utc?: number;
  body?: string;
}

export function bonExtractActivityData(raw: RedditActivityFetch): ActivityData {
  const posts: RedditPost[] = (raw.submitted?.data?.children || [])
    .map((c) => c.data as RedditPost | undefined)
    .filter((p): p is RedditPost => Boolean(p));
  const comments: RedditComment[] = (raw.comments?.data?.children || [])
    .map((c) => c.data as RedditComment | undefined)
    .filter((c): c is RedditComment => Boolean(c));
  const postTimestamps = posts
    .map((p) => (p.created_utc ? p.created_utc * 1000 : null))
    .filter((t): t is number => typeof t === "number");
  const commentTimestamps = comments
    .map((c) => (c.created_utc ? c.created_utc * 1000 : null))
    .filter((t): t is number => typeof t === "number");
  const subredditCounts: Record<string, number> = {};
  for (const item of [...posts, ...comments]) {
    const sub = (
      item.subreddit ||
      (item.subreddit_name_prefixed || "").replace(/^r\//i, "")
    )
      .toString()
      .toLowerCase();
    if (!sub) {
      continue;
    }
    subredditCounts[sub] = (subredditCounts[sub] || 0) + 1;
  }
  // Concatenate all visible user-authored text and scan for region signals
  // (non-Latin scripts, dialect/transliteration markers). The scanner lives
  // in features/regions so the script/marker tables stay in one place.
  const corpus = [
    ...posts.map((p) => `${p.title || ""}\n${p.selftext || ""}`),
    ...comments.map((c) => c.body || ""),
  ].join("\n");
  const scanned = bonScanTextSignals(corpus);
  // moderated_subreddits.json: { "data": [{ "sr": "name", ... }, ...] } when
  // the user has the "show moderated subs publicly" setting on; otherwise it
  // 403s and the caller catches → null. Either case is fine.
  const moderatedSubs = Array.isArray(raw.moderated?.data)
    ? raw.moderated.data
        .map((m) => m.sr || m.display_name || null)
        .filter((s): s is string => Boolean(s))
    : [];
  return {
    postTimestamps,
    commentTimestamps,
    subredditCounts,
    scriptSignals: scanned.scripts,
    languageSignals: scanned.languages,
    moderatedSubs,
    corpusChars: corpus.length,
    postsLimited: posts.length >= BON_REDDIT_FETCH_LIMIT,
    commentsLimited: comments.length >= BON_REDDIT_FETCH_LIMIT,
    earliestPostAt: postTimestamps.length ? Math.min(...postTimestamps) : null,
    earliestCommentAt: commentTimestamps.length
      ? Math.min(...commentTimestamps)
      : null,
    fetchLimit: BON_REDDIT_FETCH_LIMIT,
    fetchedAt: Date.now(),
  };
}
