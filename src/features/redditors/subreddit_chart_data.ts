// Pure transforms feeding the per-subreddit overlaid chart. Buckets per-sub
// posts/comments into a shared time grid and collapses the long tail into a
// single "other" series.

import type { ActivityData } from "../../types.ts";

export interface SubredditTimeline {
  sub: string;
  posts: number;
  comments: number;
  total: number;
  firstSeen: number;
  lastSeen: number;
  postEvents: number[];
  commentEvents: number[];
}

// Buckets each visible post/comment into a per-subreddit timeline. Returns
// null when the snapshot predates the parallel `postSubreddits` /
// `commentSubreddits` arrays — the renderer surfaces a "refresh" prompt.
export function redditorsBuildSubredditTimelines(
  activityData: ActivityData
): SubredditTimeline[] | null {
  const postSubs = activityData.postSubreddits;
  const commentSubs = activityData.commentSubreddits;
  if (!postSubs || !commentSubs) {
    return null;
  }

  const byName = new Map<string, { posts: number[]; comments: number[] }>();

  const ensure = (sub: string) => {
    let bucket = byName.get(sub);
    if (!bucket) {
      bucket = { posts: [], comments: [] };
      byName.set(sub, bucket);
    }

    return bucket;
  };

  const postTimestamps = activityData.postTimestamps;

  for (let i = 0; i < postTimestamps.length; i++) {
    const sub = postSubs[i];
    if (!sub) {
      continue;
    }

    ensure(sub).posts.push(postTimestamps[i]);
  }

  const commentTimestamps = activityData.commentTimestamps;

  for (let i = 0; i < commentTimestamps.length; i++) {
    const sub = commentSubs[i];
    if (!sub) {
      continue;
    }

    ensure(sub).comments.push(commentTimestamps[i]);
  }

  const timelines: SubredditTimeline[] = [];

  for (const [sub, { posts, comments }] of byName) {
    posts.sort((a, b) => a - b);
    comments.sort((a, b) => a - b);

    const all = [...posts, ...comments];
    if (all.length === 0) {
      continue;
    }

    timelines.push({
      sub,
      posts: posts.length,
      comments: comments.length,
      total: all.length,
      firstSeen: Math.min(...all),
      lastSeen: Math.max(...all),
      postEvents: posts,
      commentEvents: comments,
    });
  }

  timelines.sort((a, b) => b.total - a.total);
  return timelines;
}

export interface SubredditChartSeries {
  label: string;
  total: number;
  isOther: boolean;
  bucketCounts: number[];
}

// Top-N subreddits as individual series, everything else collapsed into a
// single "other" series. Each series is bucketed across the same range so
// they line up on a shared X-axis. Posts and comments are merged into one
// "contribution" stream — the per-line chart distinguishes by subreddit,
// not by event kind.
export function redditorsBuildSubredditChartSeries(
  timelines: SubredditTimeline[],
  rangeStart: number,
  rangeEnd: number,
  bucketCount: number,
  topN: number
): SubredditChartSeries[] {
  const span = rangeEnd - rangeStart;
  if (span <= 0 || timelines.length === 0) {
    return [];
  }

  const top = timelines.slice(0, topN);
  const rest = timelines.slice(topN);

  const bucketFor = (events: number[]): number[] => {
    const counts = new Array<number>(bucketCount).fill(0);

    for (const t of events) {
      if (t < rangeStart || t > rangeEnd) {
        continue;
      }

      const ratio = (t - rangeStart) / span;
      const index = Math.min(bucketCount - 1, Math.floor(ratio * bucketCount));
      counts[index]++;
    }

    return counts;
  };

  const series: SubredditChartSeries[] = top.map((timeline) => ({
    label: timeline.sub,
    total: timeline.total,
    isOther: false,
    bucketCounts: bucketFor([
      ...timeline.postEvents,
      ...timeline.commentEvents,
    ]),
  }));

  if (rest.length > 0) {
    const otherEvents: number[] = [];
    let otherTotal = 0;

    for (const timeline of rest) {
      otherEvents.push(...timeline.postEvents, ...timeline.commentEvents);
      otherTotal += timeline.total;
    }

    series.push({
      label: "other",
      total: otherTotal,
      isOther: true,
      bucketCounts: bucketFor(otherEvents),
    });
  }

  return series;
}
