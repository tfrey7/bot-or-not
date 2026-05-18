// Pure transform: raw Reddit JSON → activity summary used by the analyzer
// and the heatmap.

import { bonScanTextSignals } from "../features/regions/index.js";

const BON_REDDIT_FETCH_LIMIT = 100;

export function bonExtractActivityData(raw) {
  const posts = (raw.submitted?.data?.children || [])
    .map((c) => c.data)
    .filter(Boolean);
  const comments = (raw.comments?.data?.children || [])
    .map((c) => c.data)
    .filter(Boolean);
  const postTimestamps = posts
    .map((p) => (p.created_utc ? p.created_utc * 1000 : null))
    .filter((t) => typeof t === "number");
  const commentTimestamps = comments
    .map((c) => (c.created_utc ? c.created_utc * 1000 : null))
    .filter((t) => typeof t === "number");
  const subredditCounts = {};
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
        .filter(Boolean)
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
