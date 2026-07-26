// Background-sweeps card summarizing the daily blocklist cleanup: last
// sweep stats, the recent-sweep trend, the most recently freed slots, and
// the manual trigger for an immediate comprehensive sweep.

import { useState } from "preact/hooks";
import { clientSend } from "../../client.ts";
import {
  BLOCKLIST_TARGET_COUNT,
  LOW_KARMA_EVICTION_MAX,
} from "../blocklist-cleanup";
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
      subtitle={`daily · unblocks dead and sub-${LOW_KARMA_EVICTION_MAX}-karma accounts, evicts dormant ones down to ${BLOCKLIST_TARGET_COUNT}`}
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
                `${state.lastSweep.unblockedDead} dead · ${state.lastSweep.unblockedLowKarma ?? 0} low-karma · ${state.lastSweep.unblockedDormant} dormant`,
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
        <SweepNowButton />
      </div>
    </ChartCard>
  );
}

function SweepNowButton() {
  const [status, setStatus] = useState<string | null>(null);

  async function run(): Promise<void> {
    setStatus("Starting…");

    const result = await clientSend<{
      started: boolean;
      reason: "paused" | "already-running" | null;
    }>({ type: "run-blocklist-sweep" });

    if (result.started) {
      setStatus(
        "Sweep running — every blocked account gets a fresh probe. It drains on the background trickle over many minutes; stats above update as batches land."
      );
    } else if (result.reason === "paused") {
      setStatus("Not started — background maintenance is paused.");
    } else {
      setStatus("A sweep is already running.");
    }
  }

  return (
    <div class="bon-sweep-now">
      <button
        class="bon-btn"
        title="Probe every blocked account now, ignoring the daily gate and probe budget"
        onClick={() => void run()}
      >
        Run comprehensive sweep
      </button>
      {status && <span class="bon-sweep-now-status">{status}</span>}
    </div>
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
            {sweep.unblockedDead +
              sweep.unblockedDormant +
              (sweep.unblockedLowKarma ?? 0)}{" "}
            · {formatDate(sweep.at)}
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
