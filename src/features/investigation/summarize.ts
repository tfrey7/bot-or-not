// Reduces the raw Reddit profile + recent posts + recent comments into
// the compact JSON object that gets handed to Claude. Trims item text
// (post selftext to 400 chars, comment body to 500 chars), computes a
// posting-rate signal from the visible window, and rolls subreddit
// counts into a top-25 list — all so the prompt stays well under the
// context budget.

import type {
  BotBouncerStatus,
  ModeratedSubreddit,
  ModeratedSubreddits,
  ModeratorRemovals,
  PostingRate,
  ProfileSummary,
  RedditProfile,
  SummaryComment,
  SummaryPost,
  TopSubreddit,
  WebSearchResult,
} from "../../types.ts";
import { BON_REDDIT_FETCH_LIMIT } from "./fetch.ts";

const BON_MAX_ITEMS_TO_AI = 60; // per kind (posts + comments)

interface RawPost {
  subreddit?: string;
  subreddit_name_prefixed?: string;
  title?: string;
  selftext?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  url_overridden_by_dest?: string;
  permalink?: string;
  is_self?: boolean;
  over_18?: boolean;
  removed_by_category?: string | null;
}

interface RawComment {
  subreddit?: string;
  subreddit_name_prefixed?: string;
  body?: string;
  score?: number;
  created_utc?: number;
  permalink?: string;
  link_title?: string;
  removed_by_category?: string | null;
}

interface RawModeratedEntry {
  sr_display_name_prefixed?: string;
  sr?: string;
  display_name?: string;
  subscribers?: number;
  subreddit_type?: string;
  over_18?: boolean;
  url?: string;
}

// Optional inputs threaded in from bonGatherProfile. Absence is expressed
// by omission — no `null` on optional fields.
export interface SummarizeExtra {
  botBouncerStatus?: Exclude<BotBouncerStatus, null>;
  botBouncerCheckedAt?: number;
  webSearchResults?: WebSearchResult[];
}

export function bonSummarizeProfile(
  username: string,
  raw: RedditProfile,
  extra: SummarizeExtra = {}
): ProfileSummary {
  const aboutData = raw.about.data ?? {};
  const posts = extractChildren<RawPost>(raw.submitted.data?.children);
  const comments = extractChildren<RawComment>(raw.comments.data?.children);

  const createdUtc =
    typeof aboutData.created_utc === "number"
      ? aboutData.created_utc * 1000
      : null;
  const ageDays =
    createdUtc !== null
      ? Math.floor((Date.now() - createdUtc) / 86_400_000)
      : null;

  const trimmedPosts: SummaryPost[] = posts
    .slice(0, BON_MAX_ITEMS_TO_AI)
    .map(trimPost);
  const trimmedComments: SummaryComment[] = comments
    .slice(0, BON_MAX_ITEMS_TO_AI)
    .map(trimComment);

  const moderatorRemovals = countRemovals(posts, comments);
  const postingRate = computePostingRate(posts, comments);
  const moderatedSubreddits = summarizeModerated(raw.moderated?.data);
  const topSubreddits = countTopSubreddits(posts, comments);
  const avatarCustomized = bonHasCustomSnoovatar(aboutData.snoovatar_img);

  return {
    username,
    account: {
      name: aboutData.name ?? username,
      created_at:
        createdUtc !== null ? new Date(createdUtc).toISOString() : null,
      age_days: ageDays,
      total_karma: aboutData.total_karma ?? null,
      link_karma: aboutData.link_karma ?? null,
      comment_karma: aboutData.comment_karma ?? null,
      is_employee: aboutData.is_employee === true,
      verified: aboutData.verified === true,
      has_verified_email: aboutData.has_verified_email === true,
    },
    avatar: { customized: avatarCustomized },
    activity: {
      posts_fetched: posts.length,
      comments_fetched: comments.length,
      top_subreddits: topSubreddits,
      moderator_removals: moderatorRemovals,
      posting_rate: postingRate,
      moderated_subreddits: moderatedSubreddits,
    },
    external_signals: {
      bot_bouncer:
        extra.botBouncerStatus !== undefined
          ? {
              status: extra.botBouncerStatus,
              checked_at:
                extra.botBouncerCheckedAt !== undefined
                  ? new Date(extra.botBouncerCheckedAt).toISOString()
                  : null,
            }
          : null,
    },
    recent_posts: trimmedPosts,
    recent_comments: trimmedComments,
    web_search_results: extra.webSearchResults ?? [],
  };
}

// `snoovatar_img` is an empty string for default snoos and a non-empty
// PNG URL when the user customized via Reddit's avatar editor. That's
// the only check we need — Reddit doesn't surface a "default-snoo" URL
// here; default accounts return `""`. The companion `icon_img` field is
// always populated (often with a generic snoo) so it can't tell us
// whether the user actually chose anything.
export function bonHasCustomSnoovatar(snoovatarImg?: string): boolean {
  return typeof snoovatarImg === "string" && snoovatarImg.trim().length > 0;
}

export function bonExtractSnoovatarUrl(raw: RedditProfile): string | null {
  const url = raw.about.data?.snoovatar_img;
  return bonHasCustomSnoovatar(url) ? (url as string) : null;
}

function extractChildren<T>(
  children: Array<{ data?: unknown }> | undefined
): T[] {
  if (!children) {
    return [];
  }

  const items: T[] = [];

  for (const child of children) {
    if (child.data) {
      items.push(child.data as T);
    }
  }

  return items;
}

function subredditLabel(item: RawPost | RawComment): string {
  return item.subreddit_name_prefixed ?? `r/${item.subreddit ?? ""}`;
}

function trimPost(post: RawPost): SummaryPost {
  return {
    subreddit: subredditLabel(post),
    title: post.title ?? null,
    selftext_excerpt: (post.selftext ?? "").slice(0, 400),
    score: post.score ?? null,
    num_comments: post.num_comments ?? null,
    created_at:
      typeof post.created_utc === "number"
        ? new Date(post.created_utc * 1000).toISOString()
        : null,
    url: post.url_overridden_by_dest ?? null,
    permalink: post.permalink ?? null,
    is_self: post.is_self === true,
    over_18: post.over_18 === true,
    removed_by_category: post.removed_by_category ?? null,
  };
}

function trimComment(comment: RawComment): SummaryComment {
  return {
    subreddit: subredditLabel(comment),
    body_excerpt: (comment.body ?? "").slice(0, 500),
    score: comment.score ?? null,
    created_at:
      typeof comment.created_utc === "number"
        ? new Date(comment.created_utc * 1000).toISOString()
        : null,
    permalink: comment.permalink ?? null,
    link_title: comment.link_title ?? null,
    removed_by_category: comment.removed_by_category ?? null,
  };
}

function countRemovals(
  posts: RawPost[],
  comments: RawComment[]
): ModeratorRemovals {
  const removals: ModeratorRemovals = { total: 0, by_category: {} };

  for (const item of [...posts, ...comments]) {
    const category = item.removed_by_category;
    if (!category) {
      continue;
    }

    removals.total++;
    removals.by_category[category] = (removals.by_category[category] ?? 0) + 1;
  }

  return removals;
}

// Posting rate over the visible window. The fetched sample is capped at ~100
// posts + 100 comments; the window between the oldest and newest item tells us
// how fast they accumulated. A heavy farmer can hit 50+/day sustained — well
// above what a normal human (even a Stan) does.
function computePostingRate(
  posts: RawPost[],
  comments: RawComment[]
): PostingRate | null {
  const allTimestamps: number[] = [];

  for (const item of [...posts, ...comments]) {
    if (typeof item.created_utc === "number") {
      allTimestamps.push(item.created_utc * 1000);
    }
  }

  if (allTimestamps.length < 2) {
    return null;
  }

  const newest = Math.max(...allTimestamps);
  const oldest = Math.min(...allTimestamps);
  const windowDays = Math.max(newest - oldest, 1) / 86_400_000;

  return {
    visible_window_days: Number(windowDays.toFixed(2)),
    visible_items_per_day: Number(
      (allTimestamps.length / Math.max(windowDays, 1 / 24)).toFixed(2)
    ),
    sample_size: allTimestamps.length,
    sample_capped:
      posts.length >= BON_REDDIT_FETCH_LIMIT ||
      comments.length >= BON_REDDIT_FETCH_LIMIT,
  };
}

// Moderated subreddits. Reddit returns {kind: "ModeratedList", data: [...]}
// where each entry has sr_display_name_prefixed, subscribers, etc. A 403 /
// null means the user hides their mod list (rare) or has no mod roles —
// treat both as "no signal" downstream.
function summarizeModerated(
  entries: RawModeratedEntry[] | undefined
): ModeratedSubreddits {
  if (!entries) {
    return { count: 0, list: [] };
  }

  const list: ModeratedSubreddit[] = [];

  for (const entry of entries) {
    const sub = moderatedLabel(entry);
    if (sub === null) {
      continue;
    }

    list.push({
      sub,
      subscribers:
        typeof entry.subscribers === "number" ? entry.subscribers : null,
      type: entry.subreddit_type ?? null,
      over_18: entry.over_18 === true,
    });
  }

  return { count: list.length, list };
}

function moderatedLabel(entry: RawModeratedEntry): string | null {
  if (entry.sr_display_name_prefixed) {
    return entry.sr_display_name_prefixed;
  }

  if (entry.sr) {
    return `r/${entry.sr}`;
  }

  if (entry.display_name) {
    return `r/${entry.display_name}`;
  }

  return entry.url ?? null;
}

function countTopSubreddits(
  posts: RawPost[],
  comments: RawComment[]
): TopSubreddit[] {
  const counts: Record<string, number> = {};

  for (const item of [...posts, ...comments]) {
    const label = subredditLabel(item);
    counts[label] = (counts[label] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([sub, count]) => ({ sub, count }));
}
