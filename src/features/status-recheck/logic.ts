// Pure selection logic for the weekly account-status re-check. No DOM, no I/O.

import type { Report } from "../../types.ts";
import { investigationResults } from "../../utils/history.ts";
import { isSuspectedBot } from "../../verdict.ts";

export type AccountLiveness = "active" | "suspended" | "deleted";

// Re-check a suspected bot's liveness at most this often. Gating is
// per-account off `userStatusCheckedAt`, so the sweep self-paces no matter
// how often the background page wakes.
const STATUS_RECHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Reddit hits per sweep are capped so a large first-run backlog drains over
// several sessions instead of firing hundreds of requests at once. Whatever
// isn't reached stays due (its timestamp didn't move) for the next sweep.
const STATUS_RECHECK_MAX_PER_SWEEP = 25;

// Suspended/deleted is terminal — once an account is gone there's nothing
// more to learn, so we stop polling it and only keep re-checking accounts
// that are still alive (or whose status we've never resolved).
function isTerminalStatus(status: Report["userStatus"]): boolean {
  return status === "suspended" || status === "deleted";
}

// Usernames of suspected bots whose liveness is stale (or never checked) and
// not already known-gone, oldest check first, capped. `reports` is the full
// per-user map straight from storage.
export function selectDueAccounts(
  reports: Record<string, Report>,
  now: number
): string[] {
  const due: Array<{ username: string; checkedAt: number }> = [];

  for (const [username, report] of Object.entries(reports)) {
    if (!isSuspectedBot(investigationResults(report.investigation)?.verdict)) {
      continue;
    }

    if (isTerminalStatus(report.userStatus)) {
      continue;
    }

    if (now - report.userStatusCheckedAt < STATUS_RECHECK_INTERVAL_MS) {
      continue;
    }

    due.push({ username, checkedAt: report.userStatusCheckedAt });
  }

  due.sort((a, b) => a.checkedAt - b.checkedAt);

  return due
    .slice(0, STATUS_RECHECK_MAX_PER_SWEEP)
    .map((entry) => entry.username);
}
