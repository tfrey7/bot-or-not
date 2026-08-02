// Pure selection + parsing for the reported-post takedown re-check. No DOM,
// no I/O.

import type { HistoryEntry, RedditListing, Report } from "../../types.ts";

// Moderator action mostly lands within days of a report; after that the
// stamp is bookkeeping, so a few-day cadence is enough. Gating is per-entry
// off `statusCheckedAt` (never-checked entries have none and are due
// immediately), so the sweep self-paces no matter how often the background
// wakes.
const POST_RECHECK_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

// Reports old enough that a takedown is no longer coming stop being polled,
// so the tracked population doesn't grow forever with the operator's report
// history.
const POST_RECHECK_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Reddit hits per sweep are capped so a large first-run backlog drains over
// several passes instead of firing hundreds of requests at once. Whatever
// isn't reached stays due (its timestamp didn't move) for the next sweep.
const POST_RECHECK_MAX_PER_SWEEP = 25;

export interface DueReportedPost {
  permalink: string;
  kind: "post" | "comment";
}

// Still-live reported permalinks whose last check is stale (or missing),
// de-duplicated across users, oldest check first — never-checked entries
// lead, newest report first among them. A takedown stamp is terminal: once
// any removal status is recorded the permalink stops being polled.
export function reportedPostsSelectDue(
  reports: Record<string, Report>,
  now: number
): DueReportedPost[] {
  const byPermalink = new Map<
    string,
    { kind: "post" | "comment"; checkedAt: number; reportedAt: number }
  >();

  for (const report of Object.values(reports)) {
    for (const entry of report.history) {
      if (!entry.permalink || entry.status) {
        continue;
      }

      if (now - entry.at > POST_RECHECK_MAX_AGE_MS) {
        continue;
      }

      const checkedAt = entry.statusCheckedAt ?? 0;
      if (now - checkedAt < POST_RECHECK_INTERVAL_MS) {
        continue;
      }

      const existing = byPermalink.get(entry.permalink);
      if (!existing || checkedAt < existing.checkedAt) {
        byPermalink.set(entry.permalink, {
          kind: reportedEntryKind(entry),
          checkedAt,
          reportedAt: entry.at,
        });
      }
    }
  }

  return [...byPermalink.entries()]
    .sort(
      (a, b) =>
        a[1].checkedAt - b[1].checkedAt || b[1].reportedAt - a[1].reportedAt
    )
    .slice(0, POST_RECHECK_MAX_PER_SWEEP)
    .map(([permalink, meta]) => ({ permalink, kind: meta.kind }));
}

// Entries recorded before the reporting flow captured `kind` are sniffed
// from the permalink shape: a post permalink has five path segments
// (/r/sub/comments/id/slug/), a comment permalink has six or more.
function reportedEntryKind(entry: HistoryEntry): "post" | "comment" {
  if (entry.kind === "post" || entry.kind === "comment") {
    return entry.kind;
  }

  const segments = (entry.permalink ?? "").split("/").filter(Boolean);
  return segments.length >= 6 ? "comment" : "post";
}

interface ThreadPostData {
  removed_by_category?: string | null;
  author?: string;
}

interface ThreadCommentData {
  body?: string;
  author?: string;
}

// A thread's `.json` endpoint returns a two-element array: the post listing,
// then the comment listing (rooted at the target comment when the permalink
// points at one).
export type RedditThreadPayload = [
  RedditListing<ThreadPostData>,
  RedditListing<ThreadCommentData>,
];

// Removal status for the fetched thread, or null when the target is still
// live (or absent from the payload — inconclusive, treated as live so the
// entry just gets its check stamp and stays watched).
export function reportedPostsParseThreadStatus(
  payload: RedditThreadPayload,
  kind: "post" | "comment"
): "removed" | "deleted" | null {
  if (kind === "comment") {
    const comment = payload[1]?.data?.children?.[0]?.data;
    if (!comment) {
      return null;
    }

    if (comment.body === "[removed]") {
      return "removed";
    }

    if (comment.body === "[deleted]" || comment.author === "[deleted]") {
      return "deleted";
    }

    return null;
  }

  const post = payload[0]?.data?.children?.[0]?.data;
  if (!post) {
    return null;
  }

  if (post.removed_by_category === "deleted" || post.author === "[deleted]") {
    return "deleted";
  }

  if (post.removed_by_category) {
    return "removed";
  }

  return null;
}
