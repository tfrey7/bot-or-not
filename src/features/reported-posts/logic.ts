// Pure transforms for the Reported tab: flatten every user's report
// history into one newest-first list and slice it by takedown status.
// "Taken down" means status-detection has observed any removal status;
// "live" means no removal has been observed yet.

import type { HistoryEntry } from "../../types.ts";

export type ReportedPostsFilter = "all" | "taken-down" | "live";

// The projection the tab runs on — full Report records satisfy it too, so a
// cached get-all-reports payload can stand in for the slim fetch.
export interface ReportedHistorySlice {
  username: string;
  history: HistoryEntry[];
}

export interface ReportedPostRow {
  username: string;
  entry: HistoryEntry;
}

export interface ReportedPostsCounts {
  total: number;
  takenDown: number;
  live: number;
}

export function reportedPostsCollect(
  reports: ReportedHistorySlice[]
): ReportedPostRow[] {
  return reports
    .flatMap((report) =>
      report.history.map((entry) => ({ username: report.username, entry }))
    )
    .sort((a, b) => b.entry.at - a.entry.at);
}

export function reportedPostsCounts(
  rows: ReportedPostRow[]
): ReportedPostsCounts {
  const takenDown = rows.filter((row) => Boolean(row.entry.status)).length;

  return {
    total: rows.length,
    takenDown,
    live: rows.length - takenDown,
  };
}

export function reportedPostsApplyFilter(
  rows: ReportedPostRow[],
  filter: ReportedPostsFilter
): ReportedPostRow[] {
  if (filter === "taken-down") {
    return rows.filter((row) => Boolean(row.entry.status));
  }

  if (filter === "live") {
    return rows.filter((row) => !row.entry.status);
  }

  return rows;
}
