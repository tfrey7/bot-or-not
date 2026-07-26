// Pure selection logic for the blocklist cleanup sweep. No DOM, no I/O.

import type { BlocklistProbe } from "../../storage";
import type { AccountKarma, Report } from "../../types.ts";

// Same cadence as the status re-check: once an account has been confirmed
// alive, leave it alone for a week before probing again.
const LIVENESS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

// The probe budget scales so the whole list is covered in this many sweeps —
// comfortably inside the staleness window. A fixed cap of 100/day couldn't
// cover 1000 accounts on a weekly cadence (needs ~143/day), so the
// lowest-priority third of the list never even started a karma trail.
const PROBE_COVERAGE_SWEEPS = 5;

const MIN_PROBES_PER_SWEEP = 100;

// Ceiling keeps a sweep's trickle time bounded (~20 min at one probe / 5s).
const MAX_PROBES_PER_SWEEP = 250;

// An account whose karma hasn't moved across this span of probes has
// produced nothing and drawn no votes — a ban on it protects nothing.
const DORMANCY_MS = 42 * 24 * 60 * 60 * 1000;

// Eviction aims for real headroom under the 1000-slot cap, not survival at
// it: above this count, eviction-ready dormant accounts probed this sweep
// are unblocked until the list is back down to the target. The freed band
// absorbs a heavy blocking day; the tripwire re-blocks anything that wakes
// back up.
export const BLOCKLIST_TARGET_COUNT = 850;

// An account still under this much total karma isn't worth a slot in the
// 1000-cap block list — throwaways and warmup-phase accounts sit here, and
// the tripwire re-blocks any that return to activity. Unlike dormancy
// eviction this applies regardless of slot pressure.
export const LOW_KARMA_EVICTION_MAX = 1000;

export function sweepProbeBudget(blockedCount: number): number {
  const forFullCoverage = Math.ceil(blockedCount / PROBE_COVERAGE_SWEEPS);

  return Math.min(
    MAX_PROBES_PER_SWEEP,
    Math.max(MIN_PROBES_PER_SWEEP, forFullCoverage)
  );
}

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
// by lowercase. Comprehensive mode (the operator-triggered sweep) drops
// both the staleness gate and the probe budget: every blocked account is
// a candidate.
export function selectSweepCandidates(
  blocked: BlockedUser[],
  reports: Record<string, Report>,
  probes: Record<string, BlocklistProbe>,
  now: number,
  comprehensive = false
): { candidates: SweepCandidate[]; dueCount: number } {
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
    if (
      !comprehensive &&
      probe !== undefined &&
      now - probe.at < LIVENESS_STALE_MS
    ) {
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

  const due = [...knownDead, ...stale.map((entry) => entry.candidate)];

  return {
    candidates: comprehensive
      ? due
      : due.slice(0, sweepProbeBudget(blocked.length)),
    dueCount: due.length,
  };
}

// Pipeline depth for the sweep telemetry: how many accounts have a karma
// streak spanning any time at all, and how many have already matured into
// eviction candidates.
export function streakStats(probes: Record<string, BlocklistProbe>): {
  tracked: number;
  mature: number;
} {
  let tracked = 0;
  let mature = 0;

  for (const probe of Object.values(probes)) {
    const streak = karmaStreakMs(probe);

    if (streak > 0) {
      tracked++;
    }

    if (streak >= DORMANCY_MS) {
      mature++;
    }
  }

  return { tracked, mature };
}

// Alive accounts whose freshly-probed karma sits under the low-karma line.
// Like every eviction, rests on a probe from this very sweep — a stored
// karma number never authorizes an unblock.
export function selectLowKarmaEvictions(
  probedAlive: Array<{ candidate: SweepCandidate; probe: BlocklistProbe }>
): Array<{ candidate: SweepCandidate; probe: BlocklistProbe }> {
  return probedAlive.filter(
    (entry) =>
      entry.probe.karma !== null &&
      entry.probe.karma.total < LOW_KARMA_EVICTION_MAX
  );
}

// Dormant accounts to evict this sweep, only ever from the set probed alive
// this very sweep (so every eviction rests on a fresh probe) and only as
// many as needed to get the list back down to the headroom target.
// Longest-frozen first — those are the safest evictions.
export function selectDormantEvictions(
  blockedCount: number,
  probedAlive: Array<{ candidate: SweepCandidate; probe: BlocklistProbe }>
): Array<{ candidate: SweepCandidate; probe: BlocklistProbe }> {
  const excess = blockedCount - BLOCKLIST_TARGET_COUNT;

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
