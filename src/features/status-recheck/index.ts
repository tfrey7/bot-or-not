// Weekly, lowest-priority background sweep that re-checks suspected-bot
// accounts for suspension/deletion, so the reports table can mark dead ones
// with a tombstone — the active counterpart to the passive content-script
// detector in features/status-detection. Run once on background startup
// (after migrations); per-account 7-day gating (logic.ts) self-paces it, so
// even though the non-persistent background page wakes often, any given
// account is re-fetched at most weekly.

import { readReportSummaries, updateReport } from "../../storage";
import { fetchAccountLiveness } from "../../reddit/liveness.ts";
import { selectDueAccounts } from "./logic.ts";

export { statusRecheckStats } from "./logic.ts";

export async function statusRecheckSweep(): Promise<void> {
  // Slim summaries are enough — selection only reads the verdict, userStatus,
  // and last-checked timestamp, all of which survive the slimming.
  const reports = await readReportSummaries();
  const due = selectDueAccounts(reports, Date.now());

  if (due.length === 0) {
    return;
  }

  console.log(`[Bot or Not] status re-check: ${due.length} account(s) due`);

  // All probes ride the Reddit funnel (concurrency-capped, rate-limit aware)
  // at background priority, so firing them together just fills its queue
  // behind any real investigation.
  await Promise.all(due.map(recheckAccount));
}

async function recheckAccount(username: string): Promise<void> {
  const liveness = await fetchAccountLiveness(username);
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
