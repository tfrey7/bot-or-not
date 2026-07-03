// Pure selection logic for the blocklist cleanup sweep. No DOM, no I/O.

import type { BlocklistProbe } from "../../storage";
import type { AccountKarma, Report } from "../../types.ts";

// Same cadence as the status re-check: once an account has been confirmed
// alive, leave it alone for a week before probing again.
const LIVENESS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

// Reddit hits per sweep are capped so a 1000-account first run drains over
// several days instead of firing a thousand probes at once. Whatever isn't
// reached stays due (its timestamp didn't move) for the next sweep.
const MAX_PROBES_PER_SWEEP = 100;

// An account whose karma hasn't moved across this span of weekly probes has
// produced nothing and drawn no votes — a ban on it protects nothing.
const DORMANCY_MS = 42 * 24 * 60 * 60 * 1000;

// Dormant accounts are only evicted under slot pressure — a ban costs
// nothing until the 1000-cap list is nearly full, so below this count every
// dormant account keeps its slot.
const BLOCKLIST_PRESSURE_THRESHOLD = 950;

export interface BlockedUser {
  username: string;
  fullname: string | null;
}

export interface SweepCandidate {
  username: string;
  fullname: string | null;
  hasReport: boolean;
}

export function sameKarma(a: AccountKarma, b: AccountKarma): boolean {
  return a.total === b.total && a.link === b.link && a.comment === b.comment;
}

// Observed span over which the account's karma has been frozen. Zero until
// two probes have seen the same value.
function karmaStreakMs(probe: BlocklistProbe): number {
  if (probe.karma === null) {
    return 0;
  }

  return probe.at - probe.stableSince;
}

// Folds a fresh probe result into an account's karma trail: an unchanged
// value extends the streak, anything else (changed, first sighting, karma
// unavailable) restarts it at now.
export function recordProbe(
  previous: BlocklistProbe | undefined,
  karma: AccountKarma | null,
  now: number
): BlocklistProbe {
  if (
    karma !== null &&
    previous?.karma != null &&
    sameKarma(previous.karma, karma)
  ) {
    return { at: now, karma, stableSince: previous.stableSince };
  }

  return { at: now, karma, stableSince: now };
}

// Blocked accounts worth probing this sweep, ranked by expected payoff:
// every account a stored report already marks dead (cheap unblock wins —
// verified by a fresh probe before any write), then stale accounts with a
// karma streak in progress (longest first — each is the closest to maturing
// into a dormancy eviction), then the rest by lowest known karma (burned
// throwaways get abandoned; high-karma accounts are ongoing operations),
// oldest check first as the tiebreak. `reports` may be keyed with any
// casing; blocked names come in Reddit's canonical casing, so matching is
// by lowercase.
export function selectSweepCandidates(
  blocked: BlockedUser[],
  reports: Record<string, Report>,
  probes: Record<string, BlocklistProbe>,
  now: number
): SweepCandidate[] {
  const reportsByLower = new Map<string, Report>();

  for (const [username, report] of Object.entries(reports)) {
    reportsByLower.set(username.toLowerCase(), report);
  }

  const knownDead: SweepCandidate[] = [];
  const stale: Array<{
    candidate: SweepCandidate;
    streakMs: number;
    totalKarma: number;
    probedAt: number;
  }> = [];

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

    // Staleness gates on this sweep's own probe trail, not the report's
    // userStatusCheckedAt — the status re-check keeps that fresh for
    // reported accounts, which would starve their karma streaks here.
    const probe = probes[key];
    if (probe !== undefined && now - probe.at < LIVENESS_STALE_MS) {
      continue;
    }

    stale.push({
      candidate,
      streakMs: probe === undefined ? 0 : karmaStreakMs(probe),
      totalKarma: probe?.karma?.total ?? report?.totalKarma ?? Infinity,
      probedAt: probe?.at ?? 0,
    });
  }

  stale.sort((a, b) => {
    if (a.streakMs !== b.streakMs) {
      return b.streakMs - a.streakMs;
    }

    if (a.totalKarma !== b.totalKarma) {
      return a.totalKarma - b.totalKarma;
    }

    return a.probedAt - b.probedAt;
  });

  return [...knownDead, ...stale.map((entry) => entry.candidate)].slice(
    0,
    MAX_PROBES_PER_SWEEP
  );
}

// Dormant accounts to evict this sweep, only ever from the set probed alive
// this very sweep (so every eviction rests on a fresh probe) and only as
// many as needed to get the list back under the pressure threshold.
// Longest-frozen first — those are the safest evictions.
export function selectDormantEvictions(
  blockedCount: number,
  probedAlive: Array<{ candidate: SweepCandidate; probe: BlocklistProbe }>
): Array<{ candidate: SweepCandidate; probe: BlocklistProbe }> {
  const excess = blockedCount - BLOCKLIST_PRESSURE_THRESHOLD;

  if (excess <= 0) {
    return [];
  }

  const dormant = probedAlive.filter(
    (entry) => karmaStreakMs(entry.probe) >= DORMANCY_MS
  );

  dormant.sort((a, b) => karmaStreakMs(b.probe) - karmaStreakMs(a.probe));

  return dormant.slice(0, excess);
}

// Drop probe entries for accounts no longer on the block list (unblocked by
// us or by the operator) so the map stays bounded by the 1000-slot cap.
export function pruneProbes(
  probes: Record<string, BlocklistProbe>,
  blocked: BlockedUser[]
): Record<string, BlocklistProbe> {
  const blockedKeys = new Set(
    blocked.map((user) => user.username.toLowerCase())
  );
  const out: Record<string, BlocklistProbe> = {};

  for (const [username, probe] of Object.entries(probes)) {
    if (blockedKeys.has(username)) {
      out[username] = probe;
    }
  }

  return out;
}
