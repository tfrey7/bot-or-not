// Background-sweeps card summarizing the daily blocklist cleanup: last
// sweep stats, the recent-sweep trend, and the most recently freed slots.

import { BLOCKLIST_TARGET_COUNT } from "../blocklist-cleanup";
import type {
  BlocklistCleanupState,
  BlocklistSweepSummary,
} from "../../storage";
import { formatDate } from "../../utils/format_time.ts";
import { ChartCard } from "./chart_card.tsx";
import { StatRows } from "./stat_rows.tsx";

const RECENT_UNBLOCKS_SHOWN = 8;
const RECENT_SWEEPS_SHOWN = 7;

export function SweepBlocklistCard({
  state,
}: {
  state: BlocklistCleanupState;
}) {
  return (
    <ChartCard
      title="Blocklist cleanup"
      subtitle={`daily · unblocks dead accounts, evicts dormant ones down to ${BLOCKLIST_TARGET_COUNT}`}
    >
      <div>
        {state.lastSweep === null ? (
          <p class="bon-analytics-empty-small">
            First sweep hasn't run yet — it fires on background startup or the
            next hourly alarm tick.
          </p>
        ) : (
          <StatRows
            rows={[
              ["Last sweep", formatDate(state.lastSweep.at)],
              ["Blocked accounts", `${state.lastSweep.blockedCount} of 1000`],
              [
                "Probed last sweep",
                `${state.lastSweep.probedCount} of ${state.lastSweep.dueCount} due · budget ${state.lastSweep.probeBudget}`,
              ],
              [
                "Karma trails",
                `${state.lastSweep.trackedCount} tracked · ${state.lastSweep.matureCount} eviction-ready`,
              ],
              [
                "Freed last sweep",
                `${state.lastSweep.unblockedDead} dead · ${state.lastSweep.unblockedDormant} dormant`,
              ],
              ["Slots freed to date", String(state.unblocked.length)],
              [
                "Watching for returns",
                String(Object.keys(state.watchlist).length),
              ],
              ["Re-blocked returns", String(state.reblocked.length)],
            ]}
          />
        )}
        {state.history.length > 0 && <RecentSweeps history={state.history} />}
        {state.unblocked.length > 0 && (
          <RecentUnblocks unblocked={state.unblocked} />
        )}
      </div>
    </ChartCard>
  );
}

function RecentSweeps({ history }: { history: BlocklistSweepSummary[] }) {
  const recent = history.slice(-RECENT_SWEEPS_SHOWN).reverse();

  return (
    <ul class="bon-sweep-list">
      {recent.map((sweep) => (
        <li key={sweep.at}>
          <span>{sweep.blockedCount} blocked</span>
          <span class="bon-sweep-when">
            probed {sweep.probedCount} · freed{" "}
            {sweep.unblockedDead + sweep.unblockedDormant} ·{" "}
            {formatDate(sweep.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RecentUnblocks({
  unblocked,
}: {
  unblocked: BlocklistCleanupState["unblocked"];
}) {
  const recent = unblocked.slice(-RECENT_UNBLOCKS_SHOWN).reverse();

  return (
    <ul class="bon-sweep-list">
      {recent.map((entry) => (
        <li key={`${entry.username}-${entry.at}`}>
          <span class="bon-pii-name">{entry.username}</span>
          <span class="bon-sweep-when">
            {entry.reason} · {formatDate(entry.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}
