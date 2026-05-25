// Pure transform: raw Reddit JSON → activity summary used by the analyzer
// and the heatmap.

import { scanTextSignals } from "../features/regions";
import type { ActivityData, RedditActivityFetch } from "../types.ts";

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

export function extractActivityData(
  raw: RedditActivityFetch,
  fetchLimit: number = 100
): ActivityData {
  const posts: RedditPost[] = (raw.submitted.data?.children ?? [])
    .map((child) => child.data as RedditPost | undefined)
    .filter((post): post is RedditPost => Boolean(post));
  const comments: RedditComment[] = (raw.comments.data?.children ?? [])
    .map((child) => child.data as RedditComment | undefined)
    .filter((comment): comment is RedditComment => Boolean(comment));

  const itemSub = (item: RedditPost | RedditComment): string =>
    (
      item.subreddit ??
      (item.subreddit_name_prefixed ?? "").replace(/^r\//i, "")
    ).toLowerCase();

  const postTimestamps: number[] = [];
  const postSubreddits: string[] = [];

  for (const post of posts) {
    if (!post.created_utc) {
      continue;
    }

    postTimestamps.push(post.created_utc * 1000);
    postSubreddits.push(itemSub(post));
  }

  const commentTimestamps: number[] = [];
  const commentSubreddits: string[] = [];

  for (const comment of comments) {
    if (!comment.created_utc) {
      continue;
    }

    commentTimestamps.push(comment.created_utc * 1000);
    commentSubreddits.push(itemSub(comment));
  }

  const subredditCounts: Record<string, number> = {};

  for (const sub of [...postSubreddits, ...commentSubreddits]) {
    if (!sub) {
      continue;
    }

    subredditCounts[sub] = (subredditCounts[sub] ?? 0) + 1;
  }

  // Concatenate all visible user-authored text and scan for region signals
  // (non-Latin scripts, dialect/transliteration markers). The scanner lives
  // in features/regions so the script/marker tables stay in one place.
  const corpus = [
    ...posts.map((post) => `${post.title ?? ""}\n${post.selftext ?? ""}`),
    ...comments.map((comment) => comment.body ?? ""),
  ].join("\n");
  const scanned = scanTextSignals(corpus);

  // moderated_subreddits.json: { "data": [{ "sr": "name", ... }, ...] } when
  // the user has the "show moderated subs publicly" setting on; otherwise it
  // 403s and the caller catches → null. Either case is fine.
  const moderatedSubs = (raw.moderated?.data ?? [])
    .map((mod) => mod.sr ?? mod.display_name ?? null)
    .filter((name): name is string => Boolean(name));

  return {
    postTimestamps,
    commentTimestamps,
    postSubreddits,
    commentSubreddits,
    subredditCounts,
    scriptSignals: scanned.scripts,
    languageSignals: scanned.languages,
    languageSamples: scanned.languageSamples,
    moderatedSubs,
    corpusChars: corpus.length,
    postsLimited: posts.length >= fetchLimit,
    commentsLimited: comments.length >= fetchLimit,
    earliestPostAt: postTimestamps.length ? Math.min(...postTimestamps) : null,
    earliestCommentAt: commentTimestamps.length
      ? Math.min(...commentTimestamps)
      : null,
    fetchLimit,
    fetchedAt: Date.now(),
  };
}
