// Attribution worker. Each Reddit URL surfaced by the Google harvest is
// fetched from Reddit and inspected to figure out whether the user we're
// investigating actually authored anything there, or whether Google just
// matched their username inside someone else's content.
//
// Architecture:
//   - Storage holds per-post state (`attribution`, `attributionCheckedAt`,
//     `attributionAttempts`). A post is "pending" iff attribution is
//     "unknown" AND checkedAt is null AND attempts < MAX.
//   - PQueue caps concurrent Reddit fetches at ATTRIBUTION_CONCURRENCY.
//     p-retry handles transient classification failures inside a single
//     dispatch — no more re-drain-on-failure loop.
//   - googleAttributionDrain is the public idempotent entry point. It
//     scans storage and enqueues anything pending that isn't already in
//     the queue.
//
// We do NOT re-trigger investigations when attribution arrives. Verdicts
// stay stable; the next time the user re-investigates (manually or via
// the staleness check), the prompt gets the freshly attributed data.

import PQueue from "p-queue";
import pRetry from "p-retry";

import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import { redditFetchJson, RedditRequestError } from "../../reddit/client.ts";
import {
  readMaintenancePaused,
  readReport,
  readReports,
  updateReport,
} from "../../storage";
import type { GoogleHarvest, GoogleHarvestPost, Report } from "../../types.ts";

const ATTRIBUTION_CONCURRENCY = 3;
const ATTRIBUTION_MAX_ATTEMPTS = 3;

const queue = new PQueue({ concurrency: ATTRIBUTION_CONCURRENCY });

// Dedup: keys (`<reportKey>@<url>`) currently enqueued or running. Lets
// rapid-fire drain calls avoid double-enqueueing the same post.
const enqueued = new Set<string>();

// Coalesces a burst of drain() calls into one storage scan per tick.
let scanScheduled = false;

interface PendingItem {
  reportKey: string;
  username: string;
  url: string;
  attempts: number;
  firstSeenAt: number;
}

function busyKey(reportKey: string, url: string): string {
  return `${reportKey}@${url}`;
}

// Walk a Reddit comment listing (children of a `Listing` thing) and call
// `visit` for every comment node, including replies. Stops descending when
// `visit` returns true so we can short-circuit on the first match.
function walkComments(
  children: unknown,
  visit: (data: { author?: string; id?: string }) => boolean
): boolean {
  if (!Array.isArray(children)) {
    return false;
  }

  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }

    const kind = (child as { kind?: string }).kind;
    const data = (child as { data?: Record<string, unknown> }).data;

    if (kind === "t1" && data) {
      if (visit(data as { author?: string; id?: string })) {
        return true;
      }

      const replies = (data as { replies?: unknown }).replies;
      if (replies && typeof replies === "object") {
        const replyChildren = (replies as { data?: { children?: unknown } })
          .data?.children;

        if (walkComments(replyChildren, visit)) {
          return true;
        }
      }
    }
  }

  return false;
}

function authorMatches(author: unknown, username: string): boolean {
  return (
    typeof author === "string" &&
    author.toLowerCase() === username.toLowerCase()
  );
}

interface AttributionResult {
  attribution: "authored" | "mentioned" | "unknown";

  // If `false`, the worker should leave attributionCheckedAt alone and let
  // the caller decide whether to retry. Used for transient errors.
  settled: boolean;
}

async function classifyPost(
  post: GoogleHarvestPost,
  username: string
): Promise<AttributionResult> {
  // profile-* kinds are self-attributing — shouldn't end up here, but
  // belt-and-braces.
  if (post.kind === "profile-root" || post.kind === "profile-post") {
    return { attribution: "authored", settled: true };
  }

  // subreddit / other URLs aren't post-level — there's no single author to
  // check. Settle as "unknown" so the worker stops looking at them. The
  // listing-page hit still means the user has content visible there, but
  // we can't promote it without scraping the listing itself.
  if (post.kind === "subreddit" || post.kind === "other") {
    return { attribution: "unknown", settled: true };
  }

  // sub-post or comment. Append .json and ask for raw fields.
  const jsonUrl = `${post.url}.json?raw_json=1&limit=500`;

  let body: unknown;
  try {
    body = await redditFetchJson<unknown>(jsonUrl, {
      source: "attribution",
      priority: QUEUE_PRIORITY.background,
    });
  } catch (error) {
    if (error instanceof RedditRequestError) {
      // 404 / 403: the post is gone or we can't see it (deleted, private
      // sub, suspended user). Settle so we stop trying.
      if (error.httpStatus === 404 || error.httpStatus === 403) {
        return { attribution: "unknown", settled: true };
      }
    }

    // Network blip, 5xx, rate-limited, JSON parse failure. Transient.
    return { attribution: "unknown", settled: false };
  }

  if (!Array.isArray(body) || body.length < 2) {
    // Reddit normally returns a 2-element [post, comments] tuple. Anything
    // else is a surprise — treat as settled-unknown so we don't loop on it.
    return { attribution: "unknown", settled: true };
  }

  const postChildren = (body[0] as { data?: { children?: unknown } })?.data
    ?.children;
  const commentChildren = (body[1] as { data?: { children?: unknown } })?.data
    ?.children;

  if (post.kind === "comment") {
    // The SERP entry pins a specific comment. The root comment in the
    // comment-listing response is that target. If THAT comment's author
    // is the user, authored; otherwise mentioned (or unknown if deleted).
    const target = Array.isArray(commentChildren) ? commentChildren[0] : null;
    const targetData = (target as { data?: { author?: string } })?.data;
    const author = targetData?.author;

    if (author === "[deleted]" || author === "[removed]") {
      return { attribution: "unknown", settled: true };
    }

    if (authorMatches(author, username)) {
      return { attribution: "authored", settled: true };
    }

    return { attribution: "mentioned", settled: true };
  }

  // post.kind === "sub-post". User can be the OP or any commenter.
  const postData = (Array.isArray(postChildren) ? postChildren[0] : null) as {
    data?: { author?: string };
  } | null;

  if (authorMatches(postData?.data?.author, username)) {
    return { attribution: "authored", settled: true };
  }

  let foundInComments = false;
  walkComments(commentChildren, (commentData) => {
    if (authorMatches(commentData.author, username)) {
      foundInComments = true;
      return true;
    }

    return false;
  });

  if (foundInComments) {
    return { attribution: "authored", settled: true };
  }

  return { attribution: "mentioned", settled: true };
}

function recomputeAuthoredDistribution(
  posts: GoogleHarvestPost[]
): Record<string, number> {
  const out: Record<string, number> = {};

  for (const post of posts) {
    if (post.attribution === "authored" && post.subreddit) {
      out[post.subreddit] = (out[post.subreddit] || 0) + 1;
    }
  }

  return out;
}

// Locate the post by URL inside a per-username update so a concurrent
// harvest write on the same user can't get clobbered.
async function persistAttribution(
  reportKey: string,
  url: string,
  result: AttributionResult,
  attempts: number,
  now: number
): Promise<void> {
  await updateReport(reportKey, (current) => {
    if (!current?.googleHarvest) {
      return current;
    }

    const harvest = current.googleHarvest;
    const index = harvest.posts.findIndex((post) => post.url === url);
    if (index === -1) {
      return current;
    }

    const post = harvest.posts[index];

    const next: GoogleHarvestPost = {
      ...post,
      attribution: result.attribution,
      attributionAttempts: attempts,
      attributionCheckedAt: result.settled ? now : post.attributionCheckedAt,
    };

    const nextPosts = harvest.posts.slice();
    nextPosts[index] = next;

    const nextHarvest: GoogleHarvest = {
      ...harvest,
      posts: nextPosts,
      authoredSubredditDistribution: recomputeAuthoredDistribution(nextPosts),
    };

    return { ...current, googleHarvest: nextHarvest };
  });
}

function collectPending(reports: Record<string, Report>): PendingItem[] {
  const pending: PendingItem[] = [];

  for (const [reportKey, report] of Object.entries(reports)) {
    const harvest = report.googleHarvest;
    if (!harvest) {
      continue;
    }

    for (const post of harvest.posts) {
      if (post.attribution !== "unknown") {
        continue;
      }

      if (post.attributionCheckedAt !== null) {
        continue;
      }

      if (post.attributionAttempts >= ATTRIBUTION_MAX_ATTEMPTS) {
        continue;
      }

      if (enqueued.has(busyKey(reportKey, post.url))) {
        continue;
      }

      pending.push({
        reportKey,
        username: reportKey,
        url: post.url,
        attempts: post.attributionAttempts,
        firstSeenAt: post.firstSeenAt,
      });
    }
  }

  // Newest-harvested first — when the operator just ran a fresh search,
  // attribute those before older backlog.
  pending.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  return pending;
}

async function processOne(item: PendingItem): Promise<void> {
  let totalAttempts = item.attempts;
  const startedAt = Date.now();

  try {
    await pRetry(
      async () => {
        totalAttempts++;

        // Re-read just before classifying so a concurrent harvest write
        // didn't quietly drop or replace the post.
        const post = (
          await readReport(item.reportKey)
        )?.googleHarvest?.posts.find((p) => p.url === item.url);

        if (!post) {
          return;
        }

        const result = await classifyPost(post, item.username);
        if (!result.settled) {
          throw new Error("transient classification failure");
        }

        await persistAttribution(
          item.reportKey,
          item.url,
          result,
          totalAttempts,
          Date.now()
        );
      },
      {
        retries: ATTRIBUTION_MAX_ATTEMPTS - 1,
        minTimeout: 1_000,
        factor: 2,
      }
    );
  } catch (error) {
    console.error(
      `[Bot or Not] attribution worker failed on ${item.url}`,
      error
    );

    // Out of attempts — settle as unknown so we stop trying. Otherwise the
    // next harvest write would re-enqueue this same post forever.
    await persistAttribution(
      item.reportKey,
      item.url,
      { attribution: "unknown", settled: true },
      totalAttempts,
      startedAt
    );
  }
}

// Public entry point. Idempotent — callers can fire-and-forget. Coalesces
// rapid calls so a burst of harvest writes triggers at most one storage
// scan per tick.
export function googleAttributionDrain(): void {
  if (scanScheduled) {
    return;
  }

  scanScheduled = true;

  queueMicrotask(async () => {
    scanScheduled = false;

    try {
      if (await readMaintenancePaused()) {
        return;
      }

      const reports = await readReports();
      const pending = collectPending(reports);

      for (const item of pending) {
        const key = busyKey(item.reportKey, item.url);
        enqueued.add(key);

        void queue
          .add(() => processOne(item))
          .finally(() => {
            enqueued.delete(key);
          });
      }
    } catch (error) {
      console.error("[Bot or Not] attribution drain failed", error);
    }
  });
}
