// Background message handler for the Reported tab. The tab only reads each
// user's report history, and the full records (activity dumps, factor prose,
// run snapshots) are an order of magnitude larger — so it gets its own
// projection instead of riding the get-all-reports payload across the
// messaging boundary.

import { readReports } from "../../storage";
import type { ReportedHistorySlice } from "./logic.ts";

export async function reportedPostsGetHistory(): Promise<{
  reports: ReportedHistorySlice[];
}> {
  const reports = await readReports();

  const slices: ReportedHistorySlice[] = [];

  for (const [username, report] of Object.entries(reports)) {
    if (report.history.length === 0) {
      continue;
    }

    slices.push({ username, history: report.history });
  }

  return { reports: slices };
}
