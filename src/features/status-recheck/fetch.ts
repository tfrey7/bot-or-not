// Cheap, active liveness probe for the weekly re-check. Hits only
// `about.json` (not the 500-item profile pull the investigation does) and
// routes through the shared Reddit funnel, so it obeys the global rate-limit
// budget and concurrency cap. This is the active counterpart to the passive
// content-script detector in features/status-detection, which only fires on
// profiles the operator happens to browse.

import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import { redditFetchJson, RedditRequestError } from "../../reddit/client.ts";
import type { RedditAboutEnvelope } from "../../types.ts";
import type { AccountLiveness } from "./logic.ts";

// Returns the resolved liveness, or null when the result is inconclusive
// (network error, 429, 5xx) — the caller leaves the account due for the next
// sweep rather than recording a wrong status. The funnel has already paused
// itself on a 429/5xx by the time we see the error.
export async function fetchAccountLiveness(
  username: string
): Promise<AccountLiveness | null> {
  const url = `https://www.reddit.com/user/${encodeURIComponent(
    username
  )}/about.json`;

  try {
    const envelope = await redditFetchJson<RedditAboutEnvelope>(
      url,
      QUEUE_PRIORITY.background
    );

    return envelope.data?.is_suspended ? "suspended" : "active";
  } catch (error) {
    // 404 is Reddit's "nobody on Reddit goes by that name" — the account is
    // gone. Every other failure is transient; leave it due to retry.
    if (error instanceof RedditRequestError && error.httpStatus === 404) {
      return "deleted";
    }

    return null;
  }
}
