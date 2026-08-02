// Pure selection logic for the weekly account-status re-check. No DOM, no I/O.

import type { Report } from "../../types.ts";
import { isControlCohortMember } from "../../utils/control_cohort.ts";
import { investigationResults } from "../../utils/history.ts";
import { isSuspectedBot } from "../../verdict.ts";

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

// The sweep tracks two pools: every suspected bot, plus the control cohort —
// a deterministic sample of the remaining completed verdicts whose measured
// gone rate gives the bot-side rate a baseline. Returns which pool the
// account belongs to, or null if it isn't tracked at all.
function trackedPool(
  username: string,
  report: Report
): "bot" | "control" | null {
  const verdict = investigationResults(report.investigation)?.verdict;

  if (!verdict) {
    return null;
  }

  if (isSuspectedBot(verdict)) {
    return "bot";
  }

  if (isControlCohortMember(username)) {
    return "control";
  }

  return null;
}

// Rollup for the diagnostics card on the reports page's metrics tab.
export interface StatusRecheckStats {
  tracked: number;
  controlTracked: number;
  dueNow: number;
  checkedLastWeek: number;
  suspended: number;
  deleted: number;
  lastCheckedAt: number | null;
}

export function statusRecheckStats(
  reports: Array<Report & { username: string }>,
  now: number
): StatusRecheckStats {
  const stats: StatusRecheckStats = {
    tracked: 0,
    controlTracked: 0,
    dueNow: 0,
    checkedLastWeek: 0,
    suspended: 0,
    deleted: 0,
    lastCheckedAt: null,
  };

  for (const report of reports) {
    if (report.userStatus === "suspended") {
      stats.suspended++;
    }

    if (report.userStatus === "deleted") {
      stats.deleted++;
    }

    if (report.userStatusCheckedAt > 0) {
      if (now - report.userStatusCheckedAt < STATUS_RECHECK_INTERVAL_MS) {
        stats.checkedLastWeek++;
      }

      stats.lastCheckedAt = Math.max(
        stats.lastCheckedAt ?? 0,
        report.userStatusCheckedAt
      );
    }

    const pool = trackedPool(report.username, report);

    if (pool === null) {
      continue;
    }

    if (isTerminalStatus(report.userStatus)) {
      continue;
    }

    if (pool === "bot") {
      stats.tracked++;
    } else {
      stats.controlTracked++;
    }

    if (now - report.userStatusCheckedAt >= STATUS_RECHECK_INTERVAL_MS) {
      stats.dueNow++;
    }
  }

  return stats;
}

// Usernames of tracked accounts (suspected bots + control cohort) whose
// liveness is stale (or never checked) and not already known-gone, oldest
// check first, capped. `reports` is the full per-user map straight from
// storage.
export function selectDueAccounts(
  reports: Record<string, Report>,
  now: number
): string[] {
  const due: Array<{ username: string; checkedAt: number }> = [];

  for (const [username, report] of Object.entries(reports)) {
    if (trackedPool(username, report) === null) {
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
