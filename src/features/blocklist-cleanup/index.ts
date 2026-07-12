// Daily background sweep that frees slots in the operator's 1000-cap Reddit
// block list. Cross-references the blocked accounts against stored reports,
// probes the stale/unknown ones for liveness and karma, unblocks any account
// Reddit has since suspended or deleted, and — only when the list is under
// slot pressure — evicts accounts whose karma has been frozen long enough to
// prove dormancy. An unblock only ever rests on a fresh about.json probe
// from this very sweep — stored statuses (which may be DOM-scraped) merely
// prioritize who gets probed first, never authorize a write on their own.
// Every eviction lands on the watchlist so the content-script tripwire can
// re-block the account if it returns to activity.

import { fetchAccountLiveness } from "../../reddit/liveness.ts";
import type { BlocklistProbe, BlocklistWatchEntry } from "../../storage";
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
} from "./logic.ts";

export {
  blocklistCleanupGetState,
  blocklistReblock,
  blocklistTripwireList,
} from "./handlers.ts";
export { blocklistTripwireInit, blocklistTripwireScan } from "./tripwire.ts";

// The sweep starts by refetching the whole block list (up to 10 pages), so
// unlike the per-account-gated status re-check it needs its own gate to keep
// frequent background wakes from re-listing daily traffic for nothing.
const BLOCKLIST_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const UNBLOCKED_LOG_CAP = 1000;
const WATCHLIST_CAP = 1000;

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

  // Claim the daily gate before the probes: they drain through the funnel's
  // background trickle over many minutes, and a worker death mid-sweep must
  // not cause a full re-list + re-probe on the next wake. Real counts land
  // in the final write below.
  await writeBlocklistCleanupState({
    ...state,
    lastSweep: {
      at: now,
      blockedCount: state.lastSweep?.blockedCount ?? 0,
      probedCount: 0,
      unblockedCount: 0,
    },
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
    await writeBlocklistCleanupState(state);
    return;
  }

  const reports = await readReportSummaries();
  const probes = pruneProbes(state.probes, blocked);
  const candidates = selectSweepCandidates(blocked, reports, probes, now);

  console.log(
    `[Bot or Not] blocklist cleanup: ${blocked.length} blocked account(s), ${candidates.length} due for a liveness probe`
  );

  const results = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      probe: await fetchAccountLiveness(candidate.username, "blocklist"),
    }))
  );

  const dead: SweepCandidate[] = [];
  const alive: Array<{ candidate: SweepCandidate; probe: BlocklistProbe }> = [];
  let karmaVisibleCount = 0;

  for (const { candidate, probe } of results) {
    if (probe === null) {
      continue;
    }

    const key = candidate.username.toLowerCase();

    if (probe.karma !== null) {
      karmaVisibleCount++;
    }

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

  console.log(
    `[Bot or Not] blocklist cleanup: ${alive.length} probe(s) came back active, karma visible on ${karmaVisibleCount}`
  );

  const unblocked = [...state.unblocked];
  const watchlist = { ...state.watchlist };
  let unblockedCount = 0;

  // Operator re-blocked a watched account by hand — stop watching it.
  const blockedKeys = new Set(
    blocked.map((user) => user.username.toLowerCase())
  );

  for (const key of Object.keys(watchlist)) {
    if (blockedKeys.has(key)) {
      delete watchlist[key];
    }
  }

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
          unblocked.push({
            username: candidate.username,
            at: Date.now(),
            reason,
          });
          watchlist[key] = watch ?? { at: now, karma: null };
          unblockedCount++;
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

  await writeBlocklistCleanupState({
    lastSweep: {
      at: now,
      blockedCount: blocked.length,
      probedCount: candidates.length,
      unblockedCount,
    },
    probes,
    unblocked: unblocked.slice(-UNBLOCKED_LOG_CAP),
    watchlist: pruneWatchlist(watchlist),
    reblocked: state.reblocked,
  });
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
