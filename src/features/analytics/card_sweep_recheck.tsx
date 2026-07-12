// Background-sweeps card summarizing the weekly status re-check: how many
// suspected bots are being tracked for liveness and how many have already
// been tombstoned.

import { statusRecheckStats } from "../status-recheck";
import type { StatusRecheckState } from "../../storage";
import type { Report } from "../../types.ts";
import { formatDate } from "../../utils/format_time.ts";
import { ChartCard } from "./chart_card.tsx";
import { StatRows } from "./stat_rows.tsx";

export function SweepRecheckCard({
  reports,
  state,
}: {
  reports: Report[];
  state: StatusRecheckState | null;
}) {
  const stats = statusRecheckStats(reports, Date.now());

  return (
    <ChartCard
      title="Status re-check"
      subtitle="weekly per account, one pass every 6h · tombstones suspected bots Reddit has removed"
    >
      <StatRows
        rows={[
          ["Suspected bots tracked", String(stats.tracked)],
          ["Due for re-check", String(stats.dueNow)],
          ["Checked in last 7 days", String(stats.checkedLastWeek)],
          [
            "Tombstoned",
            `${stats.suspended} suspended · ${stats.deleted} deleted`,
          ],
          [
            "Last pass",
            state?.lastSweepAt == null
              ? "not yet"
              : `${formatDate(state.lastSweepAt)} · ${state.lastProbed} probed`,
          ],
          [
            "Most recent check",
            stats.lastCheckedAt === null
              ? "never"
              : formatDate(stats.lastCheckedAt),
          ],
        ]}
      />
    </ChartCard>
  );
}
