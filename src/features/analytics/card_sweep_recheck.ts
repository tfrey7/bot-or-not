// Background-sweeps card summarizing the weekly status re-check: how many
// suspected bots are being tracked for liveness and how many have already
// been tombstoned.

import { statusRecheckStats } from "../status-recheck";
import type { Report } from "../../types.ts";
import { formatDate } from "../../utils/format_time.ts";
import { analyticsChartCard } from "./chart_card.ts";
import { analyticsStatRows } from "./stat_rows.ts";

export function analyticsSweepRecheckCard(reports: Report[]): HTMLDivElement {
  const stats = statusRecheckStats(reports, Date.now());

  return analyticsChartCard(
    "Status re-check",
    "weekly · tombstones suspected bots Reddit has removed",
    analyticsStatRows([
      ["Suspected bots tracked", String(stats.tracked)],
      ["Due for re-check", String(stats.dueNow)],
      ["Checked in last 7 days", String(stats.checkedLastWeek)],
      ["Tombstoned", `${stats.suspended} suspended · ${stats.deleted} deleted`],
      [
        "Most recent check",
        stats.lastCheckedAt === null
          ? "never"
          : formatDate(stats.lastCheckedAt),
      ],
    ])
  );
}
