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
import { bonShortUrl } from "../../utils/format_text.ts";

// Reddit's per-request listing cap. The API silently clamps anything
// higher to 100, so we paginate via `after=` cursors to reach the
// configured target.
export const BON_REDDIT_PAGE_LIMIT = 100;

// Target item count per listing (submitted / comments). The investigation
// fetch paginates to this depth so the heatmap, calendar, region inference,
// and timezone signal all share the same dataset as the AI verdict.
export const BON_REDDIT_FETCH_LIMIT = 300;

export class RedditFetchError extends Error {
  metrics: RedditMetrics;
  constructor(message: string, metrics: RedditMetrics) {
    super(message);
    this.name = "RedditFetchError";
    this.metrics = metrics;
  }
}

export async function bonTimed<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();

  try {
    const result = await task();
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms`);
    return result;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms (failed)`);
    throw error;
  }
}

export async function bonFetchJson<T = unknown>(url: string): Promise<T> {
  return bonTimed(`fetch ${bonShortUrl(url)}`, async () => {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });

    if (!response.ok) {
      const error = new Error(`Reddit fetch ${response.status} for ${url}`);
      (error as Error & { httpStatus?: number }).httpStatus = response.status;
      throw error;
    }

    return response.json() as Promise<T>;
  });
}

interface MeasuredFetch<T> {
  data: T | null;
  metric: RedditFetchMetric;
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
    const data = await bonFetchJson<T>(url);
    return {
      data,
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
      typeof (error as { httpStatus?: number })?.httpStatus === "number"
        ? (error as { httpStatus: number }).httpStatus
        : null;

    return {
      data: null,
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

  while (allChildren.length < targetCount) {
    const remaining = targetCount - allChildren.length;
    const pageLimit = Math.min(BON_REDDIT_PAGE_LIMIT, remaining);
    const afterParam: string = cursor
      ? `&after=${encodeURIComponent(cursor)}`
      : "";
    const url: string = `${pathBase}?limit=${pageLimit}${afterParam}&raw_json=1`;

    const page = await measureFetch<RedditListing>(endpoint, url);
    metrics.push(page.metric);

    if (!page.data) {
      if (allChildren.length === 0) {
        return { data: null, metrics };
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

export async function bonFetchBotBouncerStatus(
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

export async function bonFetchRedditProfile(
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
      BON_REDDIT_FETCH_LIMIT
    ),
    measureFetchListingPaginated(
      "comments",
      `https://www.reddit.com/user/${encodedUsername}/comments.json`,
      BON_REDDIT_FETCH_LIMIT
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
    throw new RedditFetchError(
      `Reddit about fetch failed${
        about.metric.httpStatus ? ` (${about.metric.httpStatus})` : ""
      }`,
      { fetches, totalDurationMs: 0 }
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
    throw new RedditFetchError(
      `Reddit ${name} fetch failed${
        lastMetric?.httpStatus ? ` (${lastMetric.httpStatus})` : ""
      }`,
      { fetches, totalDurationMs: 0 }
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
