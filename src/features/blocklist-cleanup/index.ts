// Daily background sweep that frees slots in the operator's 1000-cap Reddit
// block list. Cross-references the blocked accounts against stored reports,
// probes the stale/unknown ones for liveness, and unblocks any account
// Reddit has since suspended or deleted. An unblock only ever fires off a
// fresh about.json probe from this very sweep — stored statuses (which may
// be DOM-scraped) merely prioritize who gets probed first, never authorize
// a write on their own.

import { fetchAccountLiveness } from "../../reddit/liveness.ts";
import {
  readBlocklistCleanupState,
  readReportSummaries,
  updateReport,
  writeBlocklistCleanupState,
} from "../../storage";
import { fetchBlockedUsers, fetchSelfIdentity, postUnblock } from "./fetch.ts";
import type { BlockedUser, SweepCandidate } from "./logic.ts";
import { pruneProbedAt, selectSweepCandidates } from "./logic.ts";

export { blocklistCleanupGetState } from "./handlers.ts";

// The sweep starts by refetching the whole block list (up to 10 pages), so
// unlike the per-account-gated status re-check it needs its own gate to keep
// frequent background wakes from re-listing daily traffic for nothing.
const BLOCKLIST_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const UNBLOCKED_LOG_CAP = 1000;

export async function blocklistCleanupSweep(): Promise<void> {
  const state = await readBlocklistCleanupState();
  const now = Date.now();

  if (
    state.lastSweep &&
    now - state.lastSweep.at < BLOCKLIST_SWEEP_INTERVAL_MS
  ) {
    return;
  }

  let blocked: BlockedUser[];
  try {
    blocked = await fetchBlockedUsers();
  } catch (error) {
    console.warn(
      "[Bot or Not] blocklist cleanup: block list fetch failed",
      error
    );

    return;
  }

  const reports = await readReportSummaries();
  const candidates = selectSweepCandidates(
    blocked,
    reports,
    state.probedAt,
    now
  );

  console.log(
    `[Bot or Not] blocklist cleanup: ${blocked.length} blocked account(s), ${candidates.length} due for a liveness probe`
  );

  const probes = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      liveness: await fetchAccountLiveness(candidate.username),
    }))
  );

  const probedAt = pruneProbedAt(state.probedAt, blocked);
  const dead: SweepCandidate[] = [];

  for (const { candidate, liveness } of probes) {
    if (liveness === null) {
      continue;
    }

    if (candidate.hasReport) {
      await updateReport(candidate.username, (current) => {
        if (!current) {
          return null;
        }

        return {
          ...current,
          userStatus: liveness,
          userStatusCheckedAt: Date.now(),
        };
      });
    } else if (liveness === "active") {
      probedAt[candidate.username.toLowerCase()] = now;
    }

    if (liveness !== "active") {
      dead.push(candidate);
    }
  }

  const unblocked = [...state.unblocked];
  let unblockedCount = 0;

  if (dead.length > 0) {
    const self = await fetchSelfIdentity();

    if (self === null) {
      console.warn(
        "[Bot or Not] blocklist cleanup: no modhash available — leaving dead accounts blocked this sweep"
      );
    } else {
      for (const candidate of dead) {
        try {
          await postUnblock(candidate, self);
          delete probedAt[candidate.username.toLowerCase()];
          unblocked.push({ username: candidate.username, at: Date.now() });
          unblockedCount++;
          console.log(
            `[Bot or Not] blocklist cleanup: unblocked ${candidate.username} — account is gone, slot freed`
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
    probedAt,
    unblocked: unblocked.slice(-UNBLOCKED_LOG_CAP),
  });
}
