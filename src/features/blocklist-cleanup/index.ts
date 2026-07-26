// Daily background sweep that frees slots in the operator's 1000-cap Reddit
// block list. Cross-references the blocked accounts against stored reports,
// probes the stale/unknown ones for liveness and karma, unblocks any account
// Reddit has since suspended or deleted, and — once the list is over the
// headroom target — evicts accounts whose karma has been frozen long enough
// to prove dormancy. An unblock only ever rests on a fresh about.json probe
// from this very sweep — stored statuses (which may be DOM-scraped) merely
// prioritize who gets probed first, never authorize a write on their own.
// Every eviction lands on the watchlist so the content-script tripwire can
// re-block the account if it returns to activity.

import { fetchAccountLiveness } from "../../reddit/liveness.ts";
import type {
  BlocklistCleanupState,
  BlocklistProbe,
  BlocklistSweepSummary,
  BlocklistWatchEntry,
} from "../../storage";
import {
  readBlocklistCleanupState,
  readMaintenancePaused,
  readReportSummaries,
  updateReport,
  writeBlocklistCleanupState,
} from "../../storage";
import { fetchBlockedUsers, fetchSelfIdentity, postUnblock } from "./fetch.ts";
import type { BlockedUser, SweepCandidate } from "./logic.ts";
import {
  pruneProbes,
  recordProbe,
  selectDormantEvictions,
  selectSweepCandidates,
  streakStats,
  sweepProbeBudget,
} from "./logic.ts";

export {
  blocklistCleanupGetState,
  blocklistReblock,
  blocklistTripwireList,
} from "./handlers.ts";
export { blocklistTripwireInit, blocklistTripwireScan } from "./tripwire.ts";
export { BLOCKLIST_TARGET_COUNT } from "./logic.ts";

// The sweep starts by refetching the whole block list (up to 10 pages), so
// unlike the per-account-gated status re-check it needs its own gate to keep
// frequent background wakes from re-listing daily traffic for nothing.
const BLOCKLIST_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Startup alone can't be the trigger: content-script traffic keeps the
// background alive for days at a time, so without an alarm the "daily"
// sweep only ran at browser-restart cadence. The hourly tick just re-checks
// the daily gate above.
const SWEEP_ALARM_NAME = "bon-blocklist-sweep";
const SWEEP_ALARM_PERIOD_MINUTES = 60;

// Probe results flush to storage in batches: a full sweep takes many
// minutes on the background trickle, and a worker death mid-sweep must keep
// the karma trail accumulated so far instead of losing the day.
const PROBE_FLUSH_BATCH = 20;

const UNBLOCKED_LOG_CAP = 1000;
const WATCHLIST_CAP = 1000;
const SWEEP_HISTORY_CAP = 90;

export function blocklistSweepAlarmInit(): void {
  browser.alarms.create(SWEEP_ALARM_NAME, {
    periodInMinutes: SWEEP_ALARM_PERIOD_MINUTES,
  });
}

export function blocklistSweepOnAlarm(alarm: browser.alarms.Alarm): void {
  if (alarm.name !== SWEEP_ALARM_NAME) {
    return;
  }

  void blocklistCleanupSweep();
}

// One sweep at a time: the operator-triggered comprehensive pass bypasses
// the daily gate, so the gate alone can no longer prevent overlap with the
// alarm-driven sweep (or a double click).
let sweepInFlight = false;

export async function blocklistCleanupSweep(): Promise<void> {
  if (await readMaintenancePaused()) {
    return;
  }

  const state = await readBlocklistCleanupState();
  const now = Date.now();

  if (
    state.lastSweep &&
    now - state.lastSweep.at < BLOCKLIST_SWEEP_INTERVAL_MS
  ) {
    return;
  }

  await sweep(state, now, false);
}

// Operator-triggered from the analytics card: runs immediately (no daily
// gate) and probes every blocked account instead of the budgeted stale
// slice. Resolves once the sweep is underway — completion takes many
// minutes on the background trickle, so the caller only learns whether it
// started.
export async function blocklistRunComprehensiveSweep(): Promise<{
  started: boolean;
  reason: "paused" | "already-running" | null;
}> {
  if (sweepInFlight) {
    return { started: false, reason: "already-running" };
  }

  if (await readMaintenancePaused()) {
    return { started: false, reason: "paused" };
  }

  const state = await readBlocklistCleanupState();
  void sweep(state, Date.now(), true);

  return { started: true, reason: null };
}

async function sweep(
  state: BlocklistCleanupState,
  now: number,
  comprehensive: boolean
): Promise<void> {
  if (sweepInFlight) {
    return;
  }

  sweepInFlight = true;

  try {
    // Claim the daily gate before the probes: they drain through the
    // funnel's background trickle over many minutes, and a worker death
    // mid-sweep must not cause a full re-list + re-probe on the next wake.
    // Real counts land in the batch flushes and the final write below.
    await writeBlocklistCleanupState({
      ...state,
      lastSweep: emptySummary(now, state.lastSweep?.blockedCount ?? 0),
    });

    let blocked: BlockedUser[];
    try {
      blocked = await fetchBlockedUsers();
    } catch (error) {
      console.warn(
        "[Bot or Not] blocklist cleanup: block list fetch failed",
        error
      );

      // Un-claim so a transient listing failure retries on the next wake.
      const current = await readBlocklistCleanupState();
      await writeBlocklistCleanupState({
        ...current,
        lastSweep: state.lastSweep,
      });

      return;
    }

    try {
      await runSweep(state, blocked, now, comprehensive);
    } catch (error) {
      console.warn(
        "[Bot or Not] blocklist cleanup: sweep failed mid-pass",
        error
      );

      // Un-claim the daily gate so the failure retries on the next wake
      // instead of silently skipping a day.
      const current = await readBlocklistCleanupState();
      await writeBlocklistCleanupState({
        ...current,
        lastSweep: state.lastSweep,
      });
    }
  } finally {
    sweepInFlight = false;
  }
}

// Everything after the gate claim and block-list fetch. A throw anywhere in
// here bubbles to blocklistCleanupSweep, which un-claims the gate.
async function runSweep(
  state: BlocklistCleanupState,
  blocked: BlockedUser[],
  now: number,
  comprehensive: boolean
): Promise<void> {
  const reports = await readReportSummaries();
  const probes = pruneProbes(state.probes, blocked);
  const { candidates, dueCount } = selectSweepCandidates(
    blocked,
    reports,
    probes,
    now,
    comprehensive
  );

  const summary = emptySummary(now, blocked.length);
  summary.probeBudget = comprehensive
    ? candidates.length
    : sweepProbeBudget(blocked.length);
  summary.dueCount = dueCount;

  console.log(
    `[Bot or Not] blocklist cleanup${comprehensive ? " (comprehensive)" : ""}: ${blocked.length} blocked account(s), ${dueCount} due for a liveness probe, probing ${candidates.length}`
  );

  const dead: SweepCandidate[] = [];
  const alive: Array<{ candidate: SweepCandidate; probe: BlocklistProbe }> = [];

  for (let start = 0; start < candidates.length; start += PROBE_FLUSH_BATCH) {
    const batch = candidates.slice(start, start + PROBE_FLUSH_BATCH);
    const results = await Promise.all(
      batch.map(async (candidate) => ({
        candidate,
        probe: await fetchAccountLiveness(candidate.username, "blocklist"),
      }))
    );

    summary.probedCount += batch.length;

    for (const { candidate, probe } of results) {
      if (probe === null) {
        continue;
      }

      const key = candidate.username.toLowerCase();

      if (candidate.hasReport) {
        await updateReport(candidate.username, (current) => {
          if (!current) {
            return null;
          }

          return {
            ...current,
            userStatus: probe.status,
            userStatusCheckedAt: Date.now(),
          };
        });
      }

      if (probe.status !== "active") {
        dead.push(candidate);
        continue;
      }

      const recorded = recordProbe(probes[key], probe.karma, now);
      probes[key] = recorded;
      alive.push({ candidate, probe: recorded });
    }

    summary.aliveCount = alive.length;
    applyStreakStats(summary, probes);

    const current = await readBlocklistCleanupState();
    await writeBlocklistCleanupState({
      ...current,
      probes,
      lastSweep: { ...summary },
    });
  }

  console.log(
    `[Bot or Not] blocklist cleanup: ${alive.length} probe(s) came back active, ${summary.matureCount} account(s) eviction-ready`
  );

  const dormant = selectDormantEvictions(blocked.length - dead.length, alive);
  const evictions: Array<{
    candidate: SweepCandidate;
    reason: "dead" | "dormant";
    watch: BlocklistWatchEntry | null;
  }> = [
    ...dead.map((candidate) => ({
      candidate,
      reason: "dead" as const,
      watch: null,
    })),
    ...dormant.map((entry) => ({
      candidate: entry.candidate,
      reason: "dormant" as const,
      watch: { at: now, karma: entry.probe.karma },
    })),
  ];

  const newUnblocked: BlocklistCleanupState["unblocked"] = [];
  const newWatches: Record<string, BlocklistWatchEntry> = {};

  if (evictions.length > 0) {
    const self = await fetchSelfIdentity();

    if (self === null) {
      console.warn(
        "[Bot or Not] blocklist cleanup: no modhash available — leaving evictable accounts blocked this sweep"
      );
    } else {
      for (const { candidate, reason, watch } of evictions) {
        const key = candidate.username.toLowerCase();

        try {
          await postUnblock(candidate, self);
          delete probes[key];
          newUnblocked.push({
            username: candidate.username,
            at: Date.now(),
            reason,
          });
          newWatches[key] = watch ?? { at: now, karma: null };

          if (reason === "dead") {
            summary.unblockedDead++;
          } else {
            summary.unblockedDormant++;
          }

          console.log(
            `[Bot or Not] blocklist cleanup: unblocked ${candidate.username} — ${
              reason === "dead"
                ? "account is gone"
                : "dormant under slot pressure"
            }, slot freed`
          );
        } catch (error) {
          console.warn(
            `[Bot or Not] blocklist cleanup: unblock failed for ${candidate.username}`,
            error
          );
        }
      }
    }
  }

  applyStreakStats(summary, probes);

  // Final write re-reads state so tripwire re-blocks that landed mid-sweep
  // (watchlist removals, reblocked entries) aren't clobbered.
  const final = await readBlocklistCleanupState();
  const watchlist = { ...final.watchlist };

  // Operator re-blocked a watched account by hand — stop watching it. Runs
  // before this sweep's evictions merge in, so their fresh watches survive.
  const blockedKeys = new Set(
    blocked.map((user) => user.username.toLowerCase())
  );

  for (const key of Object.keys(watchlist)) {
    if (blockedKeys.has(key)) {
      delete watchlist[key];
    }
  }

  Object.assign(watchlist, newWatches);

  await writeBlocklistCleanupState({
    lastSweep: summary,
    history: [...final.history, summary].slice(-SWEEP_HISTORY_CAP),
    probes,
    unblocked: [...final.unblocked, ...newUnblocked].slice(-UNBLOCKED_LOG_CAP),
    watchlist: pruneWatchlist(watchlist),
    reblocked: final.reblocked,
  });
}

function emptySummary(at: number, blockedCount: number): BlocklistSweepSummary {
  return {
    at,
    blockedCount,
    probeBudget: 0,
    dueCount: 0,
    probedCount: 0,
    aliveCount: 0,
    unblockedDead: 0,
    unblockedDormant: 0,
    trackedCount: 0,
    matureCount: 0,
  };
}

function applyStreakStats(
  summary: BlocklistSweepSummary,
  probes: Record<string, BlocklistProbe>
): void {
  const streaks = streakStats(probes);
  summary.trackedCount = streaks.tracked;
  summary.matureCount = streaks.mature;
}

function pruneWatchlist(
  watchlist: Record<string, BlocklistWatchEntry>
): Record<string, BlocklistWatchEntry> {
  const entries = Object.entries(watchlist);

  if (entries.length <= WATCHLIST_CAP) {
    return watchlist;
  }

  entries.sort((a, b) => b[1].at - a[1].at);

  return Object.fromEntries(entries.slice(0, WATCHLIST_CAP));
}
