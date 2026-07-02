// Pure selection logic for the blocklist cleanup sweep. No DOM, no I/O.

import type { Report } from "../../types.ts";

// Same cadence as the status re-check: once an account has been confirmed
// alive, leave it alone for a week before probing again.
const LIVENESS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

// Reddit hits per sweep are capped so a 1000-account first run drains over
// several days instead of firing a thousand probes at once. Whatever isn't
// reached stays due (its timestamp didn't move) for the next sweep.
const MAX_PROBES_PER_SWEEP = 100;

export interface BlockedUser {
  username: string;
  fullname: string | null;
}

export interface SweepCandidate {
  username: string;
  fullname: string | null;
  hasReport: boolean;
}

// Blocked accounts worth probing this sweep: every account a stored report
// already marks dead (cheap unblock wins — verified by a fresh probe before
// any write), then accounts whose liveness is unknown or stale, oldest check
// first. `reports` may be keyed with any casing; blocked names come in
// Reddit's canonical casing, so matching is by lowercase.
export function selectSweepCandidates(
  blocked: BlockedUser[],
  reports: Record<string, Report>,
  probedAt: Record<string, number>,
  now: number
): SweepCandidate[] {
  const reportsByLower = new Map<string, Report>();

  for (const [username, report] of Object.entries(reports)) {
    reportsByLower.set(username.toLowerCase(), report);
  }

  const knownDead: SweepCandidate[] = [];
  const stale: Array<{ candidate: SweepCandidate; checkedAt: number }> = [];

  for (const user of blocked) {
    const key = user.username.toLowerCase();
    const report = reportsByLower.get(key) ?? null;
    const candidate: SweepCandidate = {
      username: user.username,
      fullname: user.fullname,
      hasReport: report !== null,
    };

    if (
      report?.userStatus === "suspended" ||
      report?.userStatus === "deleted"
    ) {
      knownDead.push(candidate);
      continue;
    }

    const checkedAt = Math.max(
      report?.userStatusCheckedAt ?? 0,
      probedAt[key] ?? 0
    );

    if (now - checkedAt >= LIVENESS_STALE_MS) {
      stale.push({ candidate, checkedAt });
    }
  }

  stale.sort((a, b) => a.checkedAt - b.checkedAt);

  return [...knownDead, ...stale.map((entry) => entry.candidate)].slice(
    0,
    MAX_PROBES_PER_SWEEP
  );
}

// Drop probe timestamps for accounts no longer on the block list (unblocked
// by us or by the operator) so the map stays bounded by the 1000-slot cap.
export function pruneProbedAt(
  probedAt: Record<string, number>,
  blocked: BlockedUser[]
): Record<string, number> {
  const blockedKeys = new Set(
    blocked.map((user) => user.username.toLowerCase())
  );
  const out: Record<string, number> = {};

  for (const [username, at] of Object.entries(probedAt)) {
    if (blockedKeys.has(username)) {
      out[username] = at;
    }
  }

  return out;
}
