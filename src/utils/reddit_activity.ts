// Pure transform: raw Reddit JSON → activity summary used by the analyzer
// and the heatmap.

import { bonNormalizeSubName, bonScanTextSignals } from "../features/regions";
import type {
  ActivityData,
  ContextItem,
  RedditActivityFetch,
} from "../types.ts";

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

export function bonExtractActivityData(
  raw: RedditActivityFetch,
  fetchLimit: number = 100
): ActivityData {
  const posts: RedditPost[] = (raw.submitted.data?.children ?? [])
    .map((child) => child.data as RedditPost | undefined)
    .filter((post): post is RedditPost => Boolean(post));
  const comments: RedditComment[] = (raw.comments.data?.children ?? [])
    .map((child) => child.data as RedditComment | undefined)
    .filter((comment): comment is RedditComment => Boolean(comment));

  const postTimestamps = posts
    .map((post) => (post.created_utc ? post.created_utc * 1000 : null))
    .filter((timestamp): timestamp is number => typeof timestamp === "number");
  const commentTimestamps = comments
    .map((comment) => (comment.created_utc ? comment.created_utc * 1000 : null))
    .filter((timestamp): timestamp is number => typeof timestamp === "number");

  const subredditCounts: Record<string, number> = {};
  for (const item of [...posts, ...comments]) {
    const subreddit = (
      item.subreddit ??
      (item.subreddit_name_prefixed ?? "").replace(/^r\//i, "")
    ).toLowerCase();
    if (!subreddit) {
      continue;
    }
    subredditCounts[subreddit] = (subredditCounts[subreddit] ?? 0) + 1;
  }

  // Concatenate all visible user-authored text and scan for region signals
  // (non-Latin scripts, dialect/transliteration markers). The scanner lives
  // in features/regions so the script/marker tables stay in one place.
  const corpus = [
    ...posts.map((post) => `${post.title ?? ""}\n${post.selftext ?? ""}`),
    ...comments.map((comment) => comment.body ?? ""),
  ].join("\n");
  const scanned = bonScanTextSignals(corpus);

  // moderated_subreddits.json: { "data": [{ "sr": "name", ... }, ...] } when
  // the user has the "show moderated subs publicly" setting on; otherwise it
  // 403s and the caller catches → null. Either case is fine.
  const moderatedSubs = (raw.moderated?.data ?? [])
    .map((mod) => mod.sr ?? mod.display_name ?? null)
    .filter((name): name is string => Boolean(name));

  return {
    postTimestamps,
    commentTimestamps,
    subredditCounts,
    scriptSignals: scanned.scripts,
    languageSignals: scanned.languages,
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

// Fold operator-collected dossier items into an ActivityData snapshot so the
// deterministic region inference (subreddit counts, scripts, language markers)
// sees them the same way it sees API-fetched posts and comments. Critical for
// accounts with hidden post histories where the operator-pasted items ARE the
// only evidence of country-coded participation.
//
// Returns the original snapshot unchanged when there are no items to merge,
// so call sites don't pay for a copy when context is empty.
export function bonAugmentActivityWithContext(
  activityData: ActivityData,
  contextItems: ContextItem[] | null | undefined
): ActivityData {
  if (!contextItems || contextItems.length === 0) {
    return activityData;
  }

  const subredditCounts = { ...activityData.subredditCounts };
  const textParts: string[] = [];

  for (const item of contextItems) {
    if (item.subreddit) {
      const normalized = bonNormalizeSubName(item.subreddit);

      if (normalized) {
        subredditCounts[normalized] = (subredditCounts[normalized] ?? 0) + 1;
      }
    }

    if (item.title) {
      textParts.push(item.title);
    }

    if (item.body) {
      textParts.push(item.body);
    }
  }

  const scanned = bonScanTextSignals(textParts.join("\n"));

  const scriptSignals = { ...activityData.scriptSignals };
  for (const [script, count] of Object.entries(scanned.scripts)) {
    scriptSignals[script] = (scriptSignals[script] ?? 0) + count;
  }

  const languageSignals = { ...activityData.languageSignals };
  for (const [language, count] of Object.entries(scanned.languages)) {
    languageSignals[language] = (languageSignals[language] ?? 0) + count;
  }

  return {
    ...activityData,
    subredditCounts,
    scriptSignals,
    languageSignals,
  };
}
