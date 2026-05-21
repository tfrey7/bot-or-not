// Attribution worker. Each Reddit URL surfaced by the Google harvest is
// fetched from Reddit and inspected to figure out whether the user we're
// investigating actually authored anything there, or whether Google just
// matched their username inside someone else's content.
//
// The queue is implicit in storage: posts with `attribution: "unknown"`
// AND `attributionCheckedAt: null` are pending. The in-memory busy set
// (`activeAttributionFetches`) bounds concurrent Reddit fetches; if the
// background worker dies, the next instance's drain re-scans storage and
// resumes — same recovery story as the investigation queue.
//
// We do NOT re-trigger investigations when attribution arrives. Verdicts
// stay stable; the next time the user re-investigates (manually or via
// the staleness check), the prompt gets the freshly attributed data.

import type { GoogleHarvest, GoogleHarvestPost, Report } from "../../types.ts";
import { bonReadReports, bonWriteReports } from "../../storage.ts";
import { bonFindReportKey } from "../../utils/history.ts";

const BON_ATTRIBUTION_CONCURRENCY = 3;
const BON_ATTRIBUTION_MAX_ATTEMPTS = 3;

// URL keys (canonical, with `<username>@` prefix so the same Reddit URL
// pending under two different report records doesn't share a slot).
const activeAttributionFetches = new Set<string>();

// Set when a drain is already scheduled / running on the current event
// loop. Coalesces back-pressure from rapid storage writes (the harvest
// merge fires sequential setGoogleHarvest calls).
let drainScheduled = false;

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

  let response: Response;
  try {
    response = await fetch(jsonUrl, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
  } catch {
    // Network blip. Bubble as transient so the worker retries.
    return { attribution: "unknown", settled: false };
  }

  // 404 / 403: the post is gone or we can't see it (deleted, private sub,
  // suspended user). Settle so we stop trying.
  if (response.status === 404 || response.status === 403) {
    return { attribution: "unknown", settled: true };
  }

  if (!response.ok) {
    // 5xx, rate-limited, etc. Transient.
    return { attribution: "unknown", settled: false };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
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

// Re-read the report, locate the post by URL, apply the result. We do a
// fresh read so a concurrent harvest write doesn't get clobbered.
async function persistAttribution(
  reportKey: string,
  url: string,
  result: AttributionResult,
  attempts: number,
  now: number
): Promise<void> {
  const reports = await bonReadReports();
  const liveKey = bonFindReportKey(reports, reportKey) ?? reportKey;
  const report = reports[liveKey];
  if (!report?.googleHarvest) {
    return;
  }

  const harvest = report.googleHarvest;
  const index = harvest.posts.findIndex((post) => post.url === url);
  if (index === -1) {
    return;
  }

  const post = harvest.posts[index];
  const giveUp = !result.settled && attempts >= BON_ATTRIBUTION_MAX_ATTEMPTS;

  const next: GoogleHarvestPost = {
    ...post,
    attribution: result.attribution,
    attributionAttempts: attempts,
    attributionCheckedAt:
      result.settled || giveUp ? now : post.attributionCheckedAt,
  };

  const nextPosts = harvest.posts.slice();
  nextPosts[index] = next;

  const nextHarvest: GoogleHarvest = {
    ...harvest,
    posts: nextPosts,
    authoredSubredditDistribution: recomputeAuthoredDistribution(nextPosts),
  };

  const nextReport: Report = { ...report, googleHarvest: nextHarvest };
  reports[liveKey] = nextReport;
  await bonWriteReports(reports);
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

      if (post.attributionAttempts >= BON_ATTRIBUTION_MAX_ATTEMPTS) {
        continue;
      }

      if (activeAttributionFetches.has(busyKey(reportKey, post.url))) {
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
  const key = busyKey(item.reportKey, item.url);
  activeAttributionFetches.add(key);
  const attempts = item.attempts + 1;
  const now = Date.now();

  try {
    // Re-read just this post for the freshest classifier inputs (kind /
    // username case-canonical). Cheap because storage reads are local.
    const reports = await bonReadReports();
    const liveKey = bonFindReportKey(reports, item.reportKey) ?? item.reportKey;
    const post = reports[liveKey]?.googleHarvest?.posts.find(
      (p) => p.url === item.url
    );

    if (!post) {
      return;
    }

    const result = await classifyPost(post, item.username);
    await persistAttribution(item.reportKey, item.url, result, attempts, now);
  } catch (error) {
    console.error(
      `[Bot or Not] attribution worker failed on ${item.url}`,
      error
    );
    await persistAttribution(
      item.reportKey,
      item.url,
      { attribution: "unknown", settled: false },
      attempts,
      now
    );
  } finally {
    activeAttributionFetches.delete(key);

    // After releasing the slot, see if there's more in the queue.
    bonGoogleAttributionDrain();
  }
}

// Public entry point. Idempotent — callers can fire-and-forget. Coalesces
// rapid calls so a burst of harvest writes triggers at most one storage
// scan per tick.
export function bonGoogleAttributionDrain(): void {
  if (drainScheduled) {
    return;
  }

  drainScheduled = true;

  // queueMicrotask lets a burst of synchronous callers coalesce without
  // forcing them to await.
  queueMicrotask(async () => {
    drainScheduled = false;

    try {
      if (activeAttributionFetches.size >= BON_ATTRIBUTION_CONCURRENCY) {
        return;
      }

      const reports = await bonReadReports();
      const pending = collectPending(reports);
      if (pending.length === 0) {
        return;
      }

      const slots = BON_ATTRIBUTION_CONCURRENCY - activeAttributionFetches.size;
      const toRun = pending.slice(0, slots);

      for (const item of toRun) {
        void processOne(item);
      }
    } catch (error) {
      console.error("[Bot or Not] attribution drain failed", error);
    }
  });
}
