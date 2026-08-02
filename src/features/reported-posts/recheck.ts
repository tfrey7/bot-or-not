// Background sweep that re-checks still-live reported posts/comments for
// moderator takedowns — the active counterpart to the passive
// features/status-detection scanner, which only sees posts the operator
// happens to browse past again. Run once on background startup (after
// migrations). Same two-gate pacing as features/status-recheck: a pass-level
// gate below, and per-entry staleness gating in recheck_logic.ts.

import {
  readMaintenancePaused,
  readPostRecheckState,
  readReports,
  updateReports,
  writePostRecheckState,
} from "../../storage";
import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import { redditFetchJson } from "../../reddit/client.ts";
import {
  reportedPostsParseThreadStatus,
  reportedPostsSelectDue,
  type DueReportedPost,
  type RedditThreadPayload,
} from "./recheck_logic.ts";

const POST_RECHECK_PASS_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function reportedPostsRecheckSweep(): Promise<void> {
  if (await readMaintenancePaused()) {
    return;
  }

  const state = await readPostRecheckState();
  const now = Date.now();

  if (
    state.lastSweepAt !== null &&
    now - state.lastSweepAt < POST_RECHECK_PASS_INTERVAL_MS
  ) {
    return;
  }

  const reports = await readReports();
  const due = reportedPostsSelectDue(reports, now);

  if (due.length > 0) {
    console.log(
      `[Bot or Not] post re-check: ${due.length} reported post(s) due`
    );

    // All probes ride the Reddit funnel's background trickle queue, so
    // firing them together just fills its queue — they drain paced.
    await Promise.all(due.map(recheckPost));
  }

  // Stamped after the probes so a worker death mid-pass leaves the gate
  // open and the remainder retries on the next wake.
  await writePostRecheckState({ lastSweepAt: now, lastChecked: due.length });
}

async function recheckPost(post: DueReportedPost): Promise<void> {
  const url = `https://www.reddit.com${post.permalink.replace(/\/$/, "")}.json`;

  let payload: RedditThreadPayload;
  try {
    payload = await redditFetchJson<RedditThreadPayload>(url, {
      source: "post-recheck",
      priority: QUEUE_PRIORITY.background,
    });
  } catch {
    // Every failure is inconclusive (a removed post still returns 200; a
    // 404/403 here means a banned sub or bad permalink, not a verified
    // takedown) — leave the entry due to retry.
    return;
  }

  const status = reportedPostsParseThreadStatus(payload, post.kind);
  await stampPostStatus(post.permalink, status);
}

// Stamp every history entry matching the permalink, across all users. A
// null status means "verified still live": `statusCheckedAt` advances so
// the per-entry gate moves forward and the UI can say when the post was
// last confirmed up, while `status` stays untouched.
async function stampPostStatus(
  permalink: string,
  status: "removed" | "deleted" | null
): Promise<void> {
  await updateReports((reports) => {
    let updated = false;

    for (const [username, existing] of Object.entries(reports)) {
      let changed = false;

      const history = existing.history.map((entry) => {
        if (entry.permalink !== permalink) {
          return entry;
        }

        changed = true;
        return {
          ...entry,
          status: status ?? entry.status,
          statusCheckedAt: Date.now(),
        };
      });

      if (changed) {
        reports[username] = { ...existing, history };
        updated = true;
      }
    }

    return updated ? reports : null;
  });
}
