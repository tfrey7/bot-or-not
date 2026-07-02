// API usage analytics — entry point + orchestrator.
//
// Two sections, one per upstream API: LLM (Claude today, other vendors
// later) and Reddit. Each section gets one chart per metric (cost /
// requests / latency on the LLM side; requests / latency on the Reddit
// side, no cost) plus a paginated run log on the LLM side, and a
// Background-sweeps section covering the hygiene passes. The run-log
// page lives in component state, which survives re-renders — so paging
// no longer rebuilds the charts, and polling-driven re-renders don't
// bounce the user back to page 1.

import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { clientSend } from "../../client.ts";
import type { BlocklistCleanupState } from "../../storage";
import type { Report } from "../../types.ts";
import { SweepBlocklistCard } from "./card_sweep_blocklist.tsx";
import { SweepRecheckCard } from "./card_sweep_recheck.tsx";
import { analyticsActivityChart } from "./chart_activity.ts";
import { UplotCard } from "./chart_card.tsx";
import { analyticsCostChart } from "./chart_cost.ts";
import { analyticsLatencyChart } from "./chart_latency.ts";
import { analyticsRedditLatencyChart } from "./chart_reddit_latency.ts";
import { analyticsRedditRequestsChart } from "./chart_reddit_requests.ts";
import { analyticsCollect } from "./logic.ts";
import { RunLog } from "./table_run_log.tsx";

export function renderAnalyticsTab(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null
): void {
  if (!container) {
    return;
  }

  render(<AnalyticsTab reports={reports} />, container);
}

function AnalyticsTab({
  reports,
}: {
  reports: Array<Report & { username: string }>;
}) {
  const [runLogPage, setRunLogPage] = useState(1);
  const [blocklistState, setBlocklistState] =
    useState<BlocklistCleanupState | null>(null);

  // Refetched whenever the reports array changes identity — same cadence as
  // the rest of the tab's data.
  useEffect(() => {
    void (async () => {
      setBlocklistState(
        await clientSend<BlocklistCleanupState>({
          type: "get-blocklist-cleanup-state",
        })
      );
    })();
  }, [reports]);

  // Memoized on the reports array identity (page.ts hands back the cached
  // array when nothing changed), so tab flips reuse the same run arrays and
  // the chart effects don't rebuild their uplot instances.
  const investigations = useMemo(() => analyticsCollect(reports), [reports]);
  const runs = useMemo(
    () => investigations.filter((entry) => entry.status === "done"),
    [investigations]
  );

  // Reddit fetches are captured on errored runs too — rate-limit and
  // suspended-user failures are exactly what makes the Reddit metrics
  // useful — so include both done and error rows there.
  const redditEligible = useMemo(
    () =>
      investigations.filter(
        (entry) => entry.status === "done" || entry.status === "error"
      ),
    [investigations]
  );
  const runsWithRedditMetrics = redditEligible.filter(
    (entry) => !!entry.redditMetrics
  ).length;

  return (
    <section class="bon-analytics">
      <header class="bon-analytics-header">
        <h2>LLM API</h2>
        <p class="bon-analytics-subtitle">
          {runs.length === 0
            ? "Cost, request rate, and latency across investigations."
            : `Cost, request rate, and latency across ${runs.length} investigation${runs.length === 1 ? "" : "s"}.`}
        </p>
      </header>
      {runs.length === 0 ? (
        <div class="bon-analytics-empty">
          No completed investigations yet. Click 🤖 on a reported user to run
          one — stats will populate here.
        </div>
      ) : (
        <>
          <RunLog
            runs={runs}
            currentPage={runLogPage}
            onPageChange={setRunLogPage}
          />
          <div class="bon-analytics-charts">
            <UplotCard
              title="Spend per day"
              runs={runs}
              build={analyticsCostChart}
            />
            <UplotCard
              title="Requests per day"
              runs={runs}
              build={analyticsActivityChart}
            />
            <UplotCard
              title="Request latency"
              subtitle="p50 (accent) · p95 (rust)"
              runs={runs}
              build={analyticsLatencyChart}
            />
          </div>
        </>
      )}
      <header class="bon-analytics-subhead">
        <h2>Reddit API</h2>
        <p class="bon-analytics-subtitle">
          {runsWithRedditMetrics === 0
            ? "Request rate and per-fetch latency."
            : `Request rate and per-fetch latency across ${runsWithRedditMetrics} investigation${runsWithRedditMetrics === 1 ? "" : "s"} with captured fetch metrics.`}
        </p>
      </header>
      {runsWithRedditMetrics === 0 ? (
        <div class="bon-analytics-empty">
          No Reddit fetch metrics captured yet. Run an investigation to populate
          this section.
        </div>
      ) : (
        <div class="bon-analytics-charts">
          <UplotCard
            title="Requests per day"
            runs={redditEligible}
            build={analyticsRedditRequestsChart}
          />
          <UplotCard
            title="Request latency"
            subtitle="p50 (accent) · p95 (rust)"
            runs={redditEligible}
            build={analyticsRedditLatencyChart}
          />
        </div>
      )}
      <header class="bon-analytics-subhead">
        <h2>Background sweeps</h2>
        <p class="bon-analytics-subtitle">
          Self-paced hygiene passes over the Reddit funnel: tombstoning removed
          accounts and clearing them off the block list.
        </p>
      </header>
      <div class="bon-analytics-charts">
        <SweepRecheckCard reports={reports} />
        {blocklistState && <SweepBlocklistCard state={blocklistState} />}
      </div>
    </section>
  );
}
