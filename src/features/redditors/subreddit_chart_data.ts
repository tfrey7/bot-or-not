// Pure transforms feeding the per-subreddit overlaid chart. Buckets per-sub
// posts/comments into a shared time grid, collapses the long tail into a
// single "other" series, and detects posting-volume ramp windows for the
// chart's conversion-period shading.

import type { ActivityData } from "../../types.ts";

const DAY_MS = 86_400_000;

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

  sortByRecency(timelines);
  return timelines;
}

// Rank by exponential-decay recency score rather than raw totals, so a sub
// the account is active in NOW outranks one with a bigger pile of years-old
// history. Half-life is anchored to the newest event across all timelines
// (not the wall clock) so frozen snapshots rank the same way forever.
const RECENCY_HALF_LIFE_MS = 90 * DAY_MS;

function sortByRecency(timelines: SubredditTimeline[]): void {
  const newestEvent = Math.max(
    ...timelines.map((timeline) => timeline.lastSeen)
  );

  const scores = new Map<SubredditTimeline, number>();

  for (const timeline of timelines) {
    let score = 0;

    for (const t of [...timeline.postEvents, ...timeline.commentEvents]) {
      score += Math.pow(2, -(newestEvent - t) / RECENCY_HALF_LIFE_MS);
    }

    scores.set(timeline, score);
  }

  timelines.sort((a, b) => {
    const scoreGap = scores.get(b)! - scores.get(a)!;
    if (scoreGap !== 0) {
      return scoreGap;
    }

    return b.total - a.total;
  });
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

export interface RampWindow {
  start: number;
  end: number;
}

const RAMP_TRAILING_WINDOW_MS = 30 * DAY_MS;
const RAMP_RATE_MULTIPLIER = 5;
const RAMP_MIN_EVENTS_PER_DAY = 2;
const RAMP_MIN_BASELINE_DAYS = 90;
const RAMP_MIN_EVENTS = 20;

// Time ranges where the trailing 30-day posting rate runs ≥5× the account's
// lifetime baseline — the volume regime change that marks an account being
// converted (sold, hijacked, activated) to bot duty. Mirrors the recent-vs-
// lifetime rate comparison the investigation pipeline scores.
//
// When a sample is capped, events before the cap's visibility horizon are
// excluded from both baseline and detection: the comment stream appearing
// mid-axis would otherwise read as a rate jump and shade a fake ramp.
export function redditorsDetectRampWindows(
  activityData: ActivityData
): RampWindow[] {
  let horizon = -Infinity;

  if (activityData.commentsLimited && activityData.earliestCommentAt != null) {
    horizon = Math.max(horizon, activityData.earliestCommentAt);
  }

  if (activityData.postsLimited && activityData.earliestPostAt != null) {
    horizon = Math.max(horizon, activityData.earliestPostAt);
  }

  const events = [
    ...activityData.postTimestamps,
    ...activityData.commentTimestamps,
  ]
    .filter((t) => t >= horizon)
    .sort((a, b) => a - b);

  if (events.length < RAMP_MIN_EVENTS) {
    return [];
  }

  const spanDays = (events[events.length - 1] - events[0]) / DAY_MS;
  if (spanDays < RAMP_MIN_BASELINE_DAYS) {
    return [];
  }

  const baselinePerDay = events.length / spanDays;
  const thresholdPerDay = Math.max(
    baselinePerDay * RAMP_RATE_MULTIPLIER,
    RAMP_MIN_EVENTS_PER_DAY
  );

  const windows: RampWindow[] = [];
  let lo = 0;

  for (let hi = 0; hi < events.length; hi++) {
    while (events[hi] - events[lo] > RAMP_TRAILING_WINDOW_MS) {
      lo++;
    }

    const windowRate = (hi - lo + 1) / (RAMP_TRAILING_WINDOW_MS / DAY_MS);

    if (windowRate < thresholdPerDay) {
      continue;
    }

    const last = windows[windows.length - 1];
    if (last && events[lo] <= last.end + RAMP_TRAILING_WINDOW_MS) {
      last.end = Math.max(last.end, events[hi]);
    } else {
      windows.push({ start: events[lo], end: events[hi] });
    }
  }

  return windows;
}
