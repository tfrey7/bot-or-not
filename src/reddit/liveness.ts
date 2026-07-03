// Cheap, active liveness probe shared by the weekly status re-check and the
// blocklist cleanup sweep. Hits only `about.json` (not the 500-item profile
// pull the investigation does) and routes through the shared Reddit funnel,
// so it obeys the global rate-limit budget and concurrency cap. This is the
// active counterpart to the passive content-script detector in
// features/status-detection, which only fires on profiles the operator
// happens to browse.

import { QUEUE_PRIORITY } from "../queue_priority.ts";
import { redditFetchJson, RedditRequestError } from "./client.ts";
import type { AccountKarma, RedditAboutEnvelope } from "../types.ts";

type AccountLiveness = "active" | "suspended" | "deleted";

// Karma rides along when the endpoint exposes it (suspended profiles and
// blocked accounts may omit the fields) so callers can track dormancy
// without a second request.
export interface AccountLivenessProbe {
  status: AccountLiveness;
  karma: AccountKarma | null;
}

// Returns the resolved probe, or null when the result is inconclusive
// (network error, 429, 5xx) — the caller leaves the account due for the next
// sweep rather than recording a wrong status. The funnel has already paused
// itself on a 429/5xx by the time we see the error.
export async function fetchAccountLiveness(
  username: string
): Promise<AccountLivenessProbe | null> {
  const url = `https://www.reddit.com/user/${encodeURIComponent(
    username
  )}/about.json`;

  try {
    const envelope = await redditFetchJson<RedditAboutEnvelope>(
      url,
      QUEUE_PRIORITY.background
    );

    return {
      status: envelope.data?.is_suspended ? "suspended" : "active",
      karma: extractKarma(envelope),
    };
  } catch (error) {
    // 404 is Reddit's "nobody on Reddit goes by that name" — the account is
    // gone. Every other failure is transient; leave it due to retry.
    if (error instanceof RedditRequestError && error.httpStatus === 404) {
      return { status: "deleted", karma: null };
    }

    return null;
  }
}

function extractKarma(envelope: RedditAboutEnvelope): AccountKarma | null {
  const data = envelope.data;

  if (
    typeof data?.total_karma !== "number" ||
    typeof data.link_karma !== "number" ||
    typeof data.comment_karma !== "number"
  ) {
    return null;
  }

  return {
    total: data.total_karma,
    link: data.link_karma,
    comment: data.comment_karma,
  };
}
