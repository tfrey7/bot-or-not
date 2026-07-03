// Background-sweeps card summarizing the daily blocklist cleanup: last
// sweep stats plus the most recently freed block-list slots.

import type { BlocklistCleanupState } from "../../storage";
import { formatDate } from "../../utils/format_time.ts";
import { ChartCard } from "./chart_card.tsx";
import { StatRows } from "./stat_rows.tsx";

const RECENT_UNBLOCKS_SHOWN = 8;

export function SweepBlocklistCard({
  state,
}: {
  state: BlocklistCleanupState;
}) {
  return (
    <ChartCard
      title="Blocklist cleanup"
      subtitle="daily · unblocks dead accounts, evicts dormant ones under slot pressure"
    >
      <div>
        {state.lastSweep === null ? (
          <p class="bon-analytics-empty-small">
            First sweep hasn't run yet — it fires on the next background
            startup.
          </p>
        ) : (
          <StatRows
            rows={[
              ["Last sweep", formatDate(state.lastSweep.at)],
              ["Blocked accounts", `${state.lastSweep.blockedCount} of 1000`],
              ["Probed last sweep", String(state.lastSweep.probedCount)],
              ["Unblocked last sweep", String(state.lastSweep.unblockedCount)],
              ["Slots freed to date", String(state.unblocked.length)],
              [
                "Watching for returns",
                String(Object.keys(state.watchlist).length),
              ],
              ["Re-blocked returns", String(state.reblocked.length)],
            ]}
          />
        )}
        {state.unblocked.length > 0 && (
          <RecentUnblocks unblocked={state.unblocked} />
        )}
      </div>
    </ChartCard>
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
