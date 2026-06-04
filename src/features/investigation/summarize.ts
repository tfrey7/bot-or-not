// Reduces the raw Reddit profile + recent posts + recent comments into
// the compact JSON object that gets handed to Claude. Trims item text
// (post selftext + comment body both to 200 chars), drops content-less
// items ([removed] / [deleted] / empty body — they contribute zero
// classifier signal but cost row overhead in the columnar payload),
// computes a posting-rate signal from the visible window, and rolls
// subreddit counts into a top-25 list.
//
// All aggregate signals (`posts_fetched`, `comments_fetched`,
// `top_subreddits`, `posting_rate`, `moderator_removals`) are computed
// over the FULL pre-filter Reddit fetch so factor math (especially
// `posting_volume` and `moderator_removal_history`) is unaffected by
// the per-item filter. Only the per-item arrays the LLM reads
// (`recent_posts` / `recent_comments`) are trimmed.

import type {
  BotBouncerStatus,
  GoogleHarvest,
  ModeratedSubreddit,
  ModeratedSubreddits,
  ModeratorRemovals,
  PassiveHarvest,
  PostingRate,
  ProfileSummary,
  RedditProfile,
  SummaryComment,
  SummaryPost,
  TopSubreddit,
} from "../../types.ts";
import { REDDIT_FETCH_LIMIT } from "./fetch.ts";

const MAX_ITEMS_TO_AI = 300; // per kind (posts + comments)
const MAX_BODY_CHARS = 200; // selftext / comment body excerpt cap

interface RawPost {
  subreddit?: string;
  subreddit_name_prefixed?: string;
  title?: string;
  selftext?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  removed_by_category?: string | null;
}

interface RawComment {
  subreddit?: string;
  subreddit_name_prefixed?: string;
  body?: string;
  score?: number;
  created_utc?: number;
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

// Optional inputs threaded in from gatherProfile. Absence is expressed
// by omission — no `null` on optional fields.
export interface SummarizeExtra {
  botBouncerStatus?: Exclude<BotBouncerStatus, null>;
  botBouncerCheckedAt?: number;
  googleHarvest?: GoogleHarvest;
  passiveHarvest?: PassiveHarvest;
}

export function summarizeProfile(
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
    .slice(0, MAX_ITEMS_TO_AI)
    .map(trimPost)
    .filter(hasPostContent);
  const trimmedComments: SummaryComment[] = comments
    .slice(0, MAX_ITEMS_TO_AI)
    .map(trimComment)
    .filter(hasCommentContent);

  const moderatorRemovals = countRemovals(posts, comments);
  const postingRate = computePostingRate(posts, comments);
  const moderatedSubreddits = summarizeModerated(raw.moderated?.data);
  const topSubreddits = countTopSubreddits(posts, comments);
  const avatarCustomized = hasCustomSnoovatar(aboutData.snoovatar_img);

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
    ...(extra.googleHarvest ? { google_harvest: extra.googleHarvest } : {}),
    ...(extra.passiveHarvest ? { passive_harvest: extra.passiveHarvest } : {}),
  };
}

// Serializer for the Claude user message. Takes the canonical ProfileSummary
// and emits a compact columnar JSON string — what Claude actually reads.
// Three compressions vs the verbose shape:
//   1. Subreddit dedup: distinct labels collected into `subs[]`; each item
//      references its sub by integer index instead of repeating the string.
//   2. Columnar rows: per-item objects collapsed into positional arrays
//      driven by `posts.cols` and `comments.cols` headers. Saves ~70 chars
//      of key overhead per item.
//   3. Trailing nulls dropped: a row that ends with one or more null
//      tail-fields just gets shorter. `rm` (removed_by_category) is null
//      on ~90% of items, so this is the bulk of the win.
// Per-item timestamps are also down-resolved to epoch *minutes* — hour /
// minute / timezone-band signal is preserved; sub-minute burst detection
// is the only loss, and the prompt's burst rule still fires at minute
// granularity (multiple items inside the same minute).
export function serializeProfileForClaude(summary: ProfileSummary): string {
  const subs: string[] = [];
  const subIndex = new Map<string, number>();
  const indexOf = (sub: string): number => {
    const cached = subIndex.get(sub);
    if (cached !== undefined) {
      return cached;
    }

    const idx = subs.length;
    subs.push(sub);
    subIndex.set(sub, idx);
    return idx;
  };

  const toEpochMinutes = (epochSeconds: number | null): number | null =>
    epochSeconds === null ? null : Math.floor(epochSeconds / 60);

  const postRows = summary.recent_posts.map((p) =>
    trimTrailingNulls([
      indexOf(p.subreddit),
      p.title,
      p.selftext_excerpt,
      p.score,
      p.num_comments,
      toEpochMinutes(p.created_at),
      p.removed_by_category,
    ])
  );

  const commentRows = summary.recent_comments.map((c) =>
    trimTrailingNulls([
      indexOf(c.subreddit),
      c.body_excerpt,
      c.score,
      toEpochMinutes(c.created_at),
      c.link_title,
      c.removed_by_category,
    ])
  );

  const payload = {
    username: summary.username,
    account: summary.account,
    avatar: summary.avatar,
    activity: summary.activity,
    external_signals: summary.external_signals,
    subs,
    posts: {
      cols: ["s", "title", "body", "score", "nc", "t_min", "rm"],
      rows: postRows,
    },
    comments: {
      cols: ["s", "body", "score", "t_min", "link", "rm"],
      rows: commentRows,
    },
    ...(summary.google_harvest
      ? { google_harvest: summary.google_harvest }
      : {}),
    ...(summary.passive_harvest
      ? { passive_harvest: summary.passive_harvest }
      : {}),
  };

  return JSON.stringify(payload);
}

function trimTrailingNulls(row: unknown[]): unknown[] {
  let end = row.length;

  while (end > 0 && row[end - 1] === null) {
    end--;
  }

  return end === row.length ? row : row.slice(0, end);
}

// `snoovatar_img` is an empty string for default snoos and a non-empty
// PNG URL when the user customized via Reddit's avatar editor. That's
// the only check we need — Reddit doesn't surface a "default-snoo" URL
// here; default accounts return `""`. The companion `icon_img` field is
// always populated (often with a generic snoo) so it can't tell us
// whether the user actually chose anything.
function hasCustomSnoovatar(snoovatarImg?: string): boolean {
  return typeof snoovatarImg === "string" && snoovatarImg.trim().length > 0;
}

export function extractSnoovatarUrl(raw: RedditProfile): string | null {
  const url = raw.about.data?.snoovatar_img;
  return hasCustomSnoovatar(url) ? (url as string) : null;
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
    selftext_excerpt: (post.selftext ?? "").slice(0, MAX_BODY_CHARS),
    score: post.score ?? null,
    num_comments: post.num_comments ?? null,
    created_at: typeof post.created_utc === "number" ? post.created_utc : null,
    removed_by_category: post.removed_by_category ?? null,
  };
}

function trimComment(comment: RawComment): SummaryComment {
  return {
    subreddit: subredditLabel(comment),
    body_excerpt: (comment.body ?? "").slice(0, MAX_BODY_CHARS),
    score: comment.score ?? null,
    created_at:
      typeof comment.created_utc === "number" ? comment.created_utc : null,
    link_title: comment.link_title ?? null,
    removed_by_category: comment.removed_by_category ?? null,
  };
}

// "Content-less" items have neither a usable body nor a title — Reddit
// emits `"[removed]"` / `"[deleted]"` (or an empty string) for both
// admin-removed and user-deleted items. The removal itself is still
// counted in `activity.moderator_removals` (computed before this
// filter), so dropping the empty row from the per-item array loses no
// signal.
function isContentless(text: string | null | undefined): boolean {
  if (text == null) {
    return true;
  }

  const stripped = text.trim();
  return (
    stripped === "" || stripped === "[removed]" || stripped === "[deleted]"
  );
}

function hasPostContent(post: SummaryPost): boolean {
  return !(isContentless(post.selftext_excerpt) && isContentless(post.title));
}

function hasCommentContent(comment: SummaryComment): boolean {
  return !isContentless(comment.body_excerpt);
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

// Posting rate over the visible window. The fetched sample is capped at
// REDDIT_FETCH_LIMIT items per kind; the window between the oldest
// and newest item tells us how fast they accumulated. A heavy farmer can
// hit 50+/day sustained — well above what a normal human (even a Superfan) does.
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
      posts.length >= REDDIT_FETCH_LIMIT ||
      comments.length >= REDDIT_FETCH_LIMIT,
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
