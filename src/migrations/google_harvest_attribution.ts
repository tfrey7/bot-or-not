// Backfills attribution fields on GoogleHarvest posts captured before the
// attribution worker existed. Old posts had no `attribution` /
// `attributionCheckedAt` / `attributionAttempts` and the harvest envelope
// had no `authoredSubredditDistribution`.
//
// profile-* kinds attribute themselves from the URL (the username is
// literally in the path), so we mark those `authored` immediately and
// stamp `attributionCheckedAt: now` so the worker doesn't bother. All
// other kinds get `attribution: "unknown"` + `attributionCheckedAt: null`
// — the queue scans for exactly that shape and will sweep them on the
// next drain.

import type {
  GoogleHarvest,
  GoogleHarvestAttribution,
  GoogleHarvestPost,
  GoogleHarvestPostKind,
} from "../types.ts";
import { bonReadReports, bonWriteReports } from "../storage.ts";

interface MaybeLegacyPost {
  kind: GoogleHarvestPostKind;
  subreddit?: string | null;
  attribution?: GoogleHarvestAttribution;
  attributionCheckedAt?: number | null;
  attributionAttempts?: number;
}

function backfillPost(
  post: MaybeLegacyPost & GoogleHarvestPost,
  now: number
): GoogleHarvestPost {
  if (post.attribution !== undefined) {
    return post;
  }

  const isProfile =
    post.kind === "profile-root" || post.kind === "profile-post";
  const needsFetch = post.kind === "sub-post" || post.kind === "comment";

  return {
    ...post,
    attribution: isProfile ? "authored" : "unknown",

    // profile-* settle as authored; subreddit/other settle as unknown
    // with checkedAt stamped (no fetch will help). Only sub-post/comment
    // enter the worker queue (checkedAt: null).
    attributionCheckedAt: needsFetch ? null : now,
    attributionAttempts: 0,
  };
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

export async function bonMigrateGoogleHarvestAttribution(): Promise<void> {
  try {
    const reports = await bonReadReports();
    const now = Date.now();

    let changed = false;

    for (const [username, report] of Object.entries(reports)) {
      const harvest = report.googleHarvest as
        | (GoogleHarvest & { authoredSubredditDistribution?: unknown })
        | null;

      if (!harvest) {
        continue;
      }

      const needsPostBackfill = harvest.posts.some(
        (post) =>
          (post as MaybeLegacyPost).attribution === undefined ||
          (post as MaybeLegacyPost).attributionCheckedAt === undefined
      );
      const needsAuthoredAggregate =
        !harvest.authoredSubredditDistribution ||
        typeof harvest.authoredSubredditDistribution !== "object";

      if (!needsPostBackfill && !needsAuthoredAggregate) {
        continue;
      }

      const posts = harvest.posts.map((post) =>
        backfillPost(post as MaybeLegacyPost & GoogleHarvestPost, now)
      );

      reports[username] = {
        ...report,
        googleHarvest: {
          ...harvest,
          posts,
          authoredSubredditDistribution: recomputeAuthoredDistribution(posts),
        },
      };
      changed = true;
    }

    if (changed) {
      await bonWriteReports(reports);
      console.log(
        "[Bot or Not] migrated google-harvest posts with attribution fields"
      );
    }
  } catch (error) {
    console.error(
      "[Bot or Not] google-harvest attribution migration failed",
      error
    );
  }
}
