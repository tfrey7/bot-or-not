// Reddit fetch primitives used by the investigation pipeline. All four
// JSON endpoints (about, submitted, comments, moderated) are fetched in
// parallel so a single investigation pays one round-trip latency, not
// four. The BotBouncer lookup is a separate active query so the AI sees
// that signal even when the user hasn't browsed an r/BotBouncer post
// recently (which is what the content script's passive detector needs).
//
// Every Reddit hit is wrapped in `measureFetch` so per-endpoint timing,
// payload size, and HTTP error status are captured on success AND
// failure. The metrics ride alongside the data so the analytics page can
// chart Reddit-side performance the same way it does the Claude call.

import { redditFetchJson, RedditRequestError } from "../../reddit/client.ts";
import type {
  BotBouncerStatus,
  RedditAboutEnvelope,
  RedditEndpoint,
  RedditFetchMetric,
  RedditListing,
  RedditMetrics,
  RedditModeratedList,
  RedditProfile,
} from "../../types.ts";

// Reddit's per-request listing cap. The API silently clamps anything
// higher to 100, so we paginate via `after=` cursors to reach the
// configured target.
export const REDDIT_PAGE_LIMIT = 100;

// Target item count per listing (submitted / comments). The investigation
// fetch paginates to this depth so the heatmap, calendar, region inference,
// and timezone signal all share the same dataset as the AI verdict.
// Reddit's hard cap is 1000 (going higher gets silently clamped), but the
// subreddit-profiling workflow scales sample size to ~100 users per sub,
// which 10x'd the per-sub Reddit-hit budget at the old 1000-item cap and
// throttled us out fast. 500 keeps enough variety for prolific-poster
// signals (visible_window_days, timezone, region) while halving Reddit
// pressure when a sub kicks off 100 fresh investigations at once.
export const REDDIT_FETCH_LIMIT = 500;

export class RedditFetchError extends Error {
  metrics: RedditMetrics;
  httpStatus: number | null;
  retryAfterMs: number | null;
  constructor(
    message: string,
    metrics: RedditMetrics,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "RedditFetchError";
    this.metrics = metrics;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

interface MeasuredFetch<T> {
  data: T | null;
  metric: RedditFetchMetric;
  retryAfterMs: number | null;
}

// Per-endpoint counter — listings expose .data.children.length; about /
// botbouncer don't carry an item count so they stay null.
function countItems(endpoint: RedditEndpoint, data: unknown): number | null {
  if (
    endpoint !== "submitted" &&
    endpoint !== "comments" &&
    endpoint !== "moderated"
  ) {
    return null;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const envelope = data as { data?: unknown };

  // Moderated subreddits envelope is { data: [...] } — listings are
  // { data: { children: [...] } }.
  if (Array.isArray(envelope.data)) {
    return envelope.data.length;
  }

  const inner = envelope.data as { children?: unknown } | undefined;
  return Array.isArray(inner?.children) ? inner.children.length : null;
}

async function measureFetch<T>(
  endpoint: RedditEndpoint,
  url: string
): Promise<MeasuredFetch<T>> {
  const start = performance.now();

  try {
    const data = await redditFetchJson<T>(url);
    return {
      data,
      retryAfterMs: null,
      metric: {
        endpoint,
        durationMs: Math.round(performance.now() - start),
        status: "ok",
        itemCount: countItems(endpoint, data),
        httpStatus: null,
      },
    };
  } catch (error) {
    const httpStatus =
      error instanceof RedditRequestError ? error.httpStatus : null;
    const retryAfterMs =
      error instanceof RedditRequestError ? error.retryAfterMs : null;

    return {
      data: null,
      retryAfterMs,
      metric: {
        endpoint,
        durationMs: Math.round(performance.now() - start),
        status: "error",
        itemCount: null,
        httpStatus,
      },
    };
  }
}

interface PaginatedListingResult {
  data: RedditListing | null;
  metrics: RedditFetchMetric[];
  retryAfterMs: number | null;
}

// Walks Reddit's `after=` cursor up to `targetCount` items. Each page is
// measured independently so per-endpoint analytics see honest per-page
// latency. Partial success returns what we have plus all page metrics;
// only a page-1 failure yields data: null.
async function measureFetchListingPaginated(
  endpoint: RedditEndpoint,
  pathBase: string,
  targetCount: number
): Promise<PaginatedListingResult> {
  const metrics: RedditFetchMetric[] = [];
  const allChildren: Array<{ data?: Record<string, unknown> }> = [];
  let cursor: string | null = null;
  let lastCursor: string | null = null;
  let lastRetryAfterMs: number | null = null;

  while (allChildren.length < targetCount) {
    const remaining = targetCount - allChildren.length;
    const pageLimit = Math.min(REDDIT_PAGE_LIMIT, remaining);
    const afterParam: string = cursor
      ? `&after=${encodeURIComponent(cursor)}`
      : "";
    const url: string = `${pathBase}?limit=${pageLimit}${afterParam}&raw_json=1`;

    const page = await measureFetch<RedditListing>(endpoint, url);
    metrics.push(page.metric);
    if (page.retryAfterMs !== null) {
      lastRetryAfterMs = page.retryAfterMs;
    }

    if (!page.data) {
      if (allChildren.length === 0) {
        return { data: null, metrics, retryAfterMs: lastRetryAfterMs };
      }

      break;
    }

    const children = page.data.data?.children ?? [];
    allChildren.push(...children);
    lastCursor = page.data.data?.after ?? null;

    if (!lastCursor || children.length === 0) {
      break;
    }

    cursor = lastCursor;
  }

  return {
    data: { data: { after: lastCursor, children: allChildren } },
    metrics,
    retryAfterMs: lastRetryAfterMs,
  };
}

interface BotBouncerPost {
  title?: string;
  link_flair_text?: string;
}

interface BotBouncerSearchResponse {
  data?: {
    children?: Array<{ data?: BotBouncerPost }>;
  };
}

export interface BotBouncerFetchResult {
  status: BotBouncerStatus;
  metric: RedditFetchMetric;
}

export async function fetchBotBouncerStatus(
  username: string
): Promise<BotBouncerFetchResult> {
  const query = encodeURIComponent(`Overview for ${username}`);
  const url = `https://www.reddit.com/r/BotBouncer/search.json?q=${query}&restrict_sr=true&sort=new&limit=10&raw_json=1`;

  const { data, metric } = await measureFetch<BotBouncerSearchResponse>(
    "botbouncer",
    url
  );

  if (!data) {
    return { status: null, metric };
  }

  const target = `overview for ${username}`.toLowerCase();

  for (const child of data.data?.children ?? []) {
    const post = child.data;
    if (!post) {
      continue;
    }

    if ((post.title ?? "").toLowerCase().trim() !== target) {
      continue;
    }

    const flair = (post.link_flair_text ?? "").toLowerCase().trim();
    if (flair === "banned" || flair === "pending" || flair === "organic") {
      return { status: flair, metric };
    }

    return { status: null, metric };
  }

  return { status: null, metric };
}

export interface RedditProfileResult {
  profile: RedditProfile;
  fetches: RedditFetchMetric[];
}

export async function fetchRedditProfile(
  username: string
): Promise<RedditProfileResult> {
  const encodedUsername = encodeURIComponent(username);
  const [about, submitted, comments, moderated] = await Promise.all([
    measureFetch<RedditAboutEnvelope>(
      "about",
      `https://www.reddit.com/user/${encodedUsername}/about.json`
    ),
    measureFetchListingPaginated(
      "submitted",
      `https://www.reddit.com/user/${encodedUsername}/submitted.json`,
      REDDIT_FETCH_LIMIT
    ),
    measureFetchListingPaginated(
      "comments",
      `https://www.reddit.com/user/${encodedUsername}/comments.json`,
      REDDIT_FETCH_LIMIT
    ),
    measureFetch<RedditModeratedList>(
      "moderated",
      `https://www.reddit.com/user/${encodedUsername}/moderated_subreddits.json?raw_json=1`
    ),
  ]);

  const fetches: RedditFetchMetric[] = [
    about.metric,
    ...submitted.metrics,
    ...comments.metrics,
    moderated.metric,
  ];

  // about/submitted/comments are load-bearing — if any failed the summary
  // would be hollow and Claude would waste an API call analyzing nothing.
  // moderated is best-effort (used to be `.catch(() => null)`).
  if (about.metric.status === "error") {
    const status = about.metric.httpStatus ?? null;
    const message =
      status === 404
        ? "User not found on Reddit (404)"
        : `Reddit about fetch failed${status ? ` (${status})` : ""}`;

    throw new RedditFetchError(
      message,
      { fetches, totalDurationMs: 0 },
      status,
      about.retryAfterMs
    );
  }

  const criticalListing = (
    [
      ["submitted", submitted],
      ["comments", comments],
    ] as const
  ).find(([, result]) => result.data === null);

  if (criticalListing) {
    const [name, result] = criticalListing;
    const lastMetric = result.metrics[result.metrics.length - 1];
    const status = lastMetric?.httpStatus ?? null;
    throw new RedditFetchError(
      `Reddit ${name} fetch failed${status ? ` (${status})` : ""}`,
      { fetches, totalDurationMs: 0 },
      status,
      result.retryAfterMs
    );
  }

  return {
    profile: {
      about: about.data ?? {},
      submitted: submitted.data ?? {},
      comments: comments.data ?? {},
      moderated: moderated.data,
    },
    fetches,
  };
}
