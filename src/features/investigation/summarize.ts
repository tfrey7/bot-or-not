// Reduces the raw Reddit profile + recent posts + recent comments into
// the compact JSON object that gets handed to Claude. Trims item text
// (post selftext to 400 chars, comment body to 500 chars), computes a
// posting-rate signal from the visible window, and rolls subreddit
// counts into a top-25 list — all so the prompt stays well under the
// context budget.

import type {
  BotBouncerStatus,
  ProfileSummary,
  RedditProfile,
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

export interface SummarizeExtra {
  botBouncerStatus?: BotBouncerStatus;
  botBouncerCheckedAt?: number | null;
}

export function bonSummarizeProfile(
  username: string,
  raw: RedditProfile,
  extra: SummarizeExtra = {}
): ProfileSummary {
  const aboutData = raw.about?.data || {};
  const posts: RawPost[] = (raw.submitted?.data?.children || [])
    .map((c) => c.data as RawPost | undefined)
    .filter((p): p is RawPost => Boolean(p));
  const comments: RawComment[] = (raw.comments?.data?.children || [])
    .map((c) => c.data as RawComment | undefined)
    .filter((c): c is RawComment => Boolean(c));

  const createdUtc = aboutData.created_utc
    ? aboutData.created_utc * 1000
    : null;
  const ageDays = createdUtc
    ? Math.floor((Date.now() - createdUtc) / 86_400_000)
    : null;

  const trimmedPosts = posts.slice(0, BON_MAX_ITEMS_TO_AI).map((p) => ({
    subreddit: p.subreddit_name_prefixed || `r/${p.subreddit}`,
    title: p.title,
    selftext_excerpt: (p.selftext || "").slice(0, 400),
    score: p.score,
    num_comments: p.num_comments,
    created_at: p.created_utc
      ? new Date(p.created_utc * 1000).toISOString()
      : null,
    url: p.url_overridden_by_dest || null,
    permalink: p.permalink,
    is_self: p.is_self,
    over_18: p.over_18,
    removed_by_category: p.removed_by_category || null,
  }));

  const trimmedComments = comments.slice(0, BON_MAX_ITEMS_TO_AI).map((c) => ({
    subreddit: c.subreddit_name_prefixed || `r/${c.subreddit}`,
    body_excerpt: (c.body || "").slice(0, 500),
    score: c.score,
    created_at: c.created_utc
      ? new Date(c.created_utc * 1000).toISOString()
      : null,
    permalink: c.permalink,
    link_title: c.link_title || null,
    removed_by_category: c.removed_by_category || null,
  }));

  const removalCounts: { total: number; by_category: Record<string, number> } =
    { total: 0, by_category: {} };
  for (const item of [...posts, ...comments]) {
    const cat = item.removed_by_category;
    if (!cat) {
      continue;
    }
    removalCounts.total++;
    removalCounts.by_category[cat] = (removalCounts.by_category[cat] || 0) + 1;
  }

  // Posting rate over the visible window. The fetched sample is capped
  // at ~100 posts + 100 comments; the window between the oldest and
  // newest item tells us how fast they accumulated. A heavy farmer can
  // hit 50+/day sustained — well above what a normal human (even a Stan)
  // does.
  const allTimestamps: number[] = [...posts, ...comments]
    .map((it) => (it.created_utc ? it.created_utc * 1000 : null))
    .filter((t): t is number => typeof t === "number");
  let postingRate: ProfileSummary["activity"]["posting_rate"] = null;
  if (allTimestamps.length >= 2) {
    const newest = Math.max(...allTimestamps);
    const oldest = Math.min(...allTimestamps);
    const windowMs = Math.max(newest - oldest, 1);
    const windowDays = windowMs / 86_400_000;
    postingRate = {
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

  // Moderated subreddits. Reddit returns
  // {kind: "ModeratedList", data: [...]} where each entry has
  // sr_display_name_prefixed, subscribers, subreddit_type, over_18, etc.
  // A 403 / null means the user hides their mod list (rare) or has no
  // mod roles — treat both as "no signal" downstream.
  const modRaw: RawModeratedEntry[] = Array.isArray(raw.moderated?.data)
    ? raw.moderated.data
    : [];
  const moderatedList = modRaw
    .map((m) => ({
      sub:
        m.sr_display_name_prefixed ||
        (m.sr ? `r/${m.sr}` : null) ||
        (m.display_name ? `r/${m.display_name}` : null) ||
        m.url ||
        null,
      subscribers: typeof m.subscribers === "number" ? m.subscribers : null,
      type: m.subreddit_type || null,
      over_18: !!m.over_18,
    }))
    .filter(
      (
        m
      ): m is {
        sub: string;
        subscribers: number | null;
        type: string | null;
        over_18: boolean;
      } => Boolean(m.sub)
    );
  const moderatedSummary = {
    count: moderatedList.length,
    list: moderatedList,
  };

  const subredditCounts: Record<string, number> = {};
  for (const p of posts) {
    const k = p.subreddit_name_prefixed || `r/${p.subreddit}`;
    subredditCounts[k] = (subredditCounts[k] || 0) + 1;
  }
  for (const c of comments) {
    const k = c.subreddit_name_prefixed || `r/${c.subreddit}`;
    subredditCounts[k] = (subredditCounts[k] || 0) + 1;
  }
  const topSubreddits = Object.entries(subredditCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([sub, count]) => ({ sub, count }));

  return {
    username,
    account: {
      name: aboutData.name || username,
      created_at: createdUtc ? new Date(createdUtc).toISOString() : null,
      age_days: ageDays,
      total_karma: aboutData.total_karma ?? null,
      link_karma: aboutData.link_karma ?? null,
      comment_karma: aboutData.comment_karma ?? null,
      is_employee: !!aboutData.is_employee,
      verified: !!aboutData.verified,
      has_verified_email: !!aboutData.has_verified_email,
    },
    activity: {
      posts_fetched: posts.length,
      comments_fetched: comments.length,
      top_subreddits: topSubreddits,
      moderator_removals: removalCounts,
      posting_rate: postingRate,
      moderated_subreddits: moderatedSummary,
    },
    external_signals: {
      bot_bouncer: extra.botBouncerStatus
        ? {
            status: extra.botBouncerStatus,
            checked_at: extra.botBouncerCheckedAt
              ? new Date(extra.botBouncerCheckedAt).toISOString()
              : null,
          }
        : null,
    },
    recent_posts: trimmedPosts,
    recent_comments: trimmedComments,
  };
}
