// Weekly, lowest-priority background sweep that re-checks suspected-bot
// accounts for suspension/deletion, so the reports table can mark dead ones
// with a tombstone — the active counterpart to the passive content-script
// detector in features/status-detection. Run once on background startup
// (after migrations). Two gates pace it: a pass-level gate (below) keeps
// frequent background wakes from firing a probe batch each time, and the
// per-account 7-day gating (logic.ts) bounds how often any given account is
// re-fetched.

import {
  readMaintenancePaused,
  readReportSummaries,
  readStatusRecheckState,
  updateReport,
  writeStatusRecheckState,
} from "../../storage";
import { fetchAccountLiveness } from "../../reddit/liveness.ts";
import { selectDueAccounts } from "./logic.ts";

export { statusRecheckStats } from "./logic.ts";

const STATUS_RECHECK_PASS_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function statusRecheckSweep(): Promise<void> {
  if (await readMaintenancePaused()) {
    return;
  }

  const state = await readStatusRecheckState();
  const now = Date.now();

  if (
    state.lastSweepAt !== null &&
    now - state.lastSweepAt < STATUS_RECHECK_PASS_INTERVAL_MS
  ) {
    return;
  }

  // Slim summaries are enough — selection only reads the verdict, userStatus,
  // and last-checked timestamp, all of which survive the slimming.
  const reports = await readReportSummaries();
  const due = selectDueAccounts(reports, now);

  if (due.length > 0) {
    console.log(`[Bot or Not] status re-check: ${due.length} account(s) due`);

    // All probes ride the Reddit funnel's background trickle queue, so
    // firing them together just fills its queue — they drain paced.
    await Promise.all(due.map(recheckAccount));
  }

  // Stamped after the probes so a worker death mid-pass leaves the gate
  // open and the remainder retries on the next wake.
  await writeStatusRecheckState({ lastSweepAt: now, lastProbed: due.length });
}

async function recheckAccount(username: string): Promise<void> {
  const liveness = await fetchAccountLiveness(username, "status-recheck");
  if (liveness === null) {
    return;
  }

  // Always advance userStatusCheckedAt — even when the status is unchanged,
  // the sweep's job is to record "checked at T, still alive" so the 7-day
  // gate moves forward and we don't re-poll a healthy account every wake.
  // (redditorsSetUserStatus skips the write on an unchanged status, which
  // would freeze the timestamp, so this job writes its own.)
  await updateReport(username, (current) => {
    if (!current) {
      return null;
    }

    return {
      ...current,
      userStatus: liveness.status,
      userStatusCheckedAt: Date.now(),
    };
  });
}
