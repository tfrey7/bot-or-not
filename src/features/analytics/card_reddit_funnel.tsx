// Reddit funnel card: live queue / rate-budget / pause state straight from
// the background's funnel, request totals from the persisted telemetry, and
// the recent rate-limit pause log.

import type { RedditFunnelSnapshot } from "../../reddit/client.ts";
import { MS_PER_HOUR } from "../../reddit/telemetry.ts";
import type { RedditTelemetryState } from "../../reddit/telemetry.ts";
import { fmtDuration, formatDate } from "../../utils/format_time.ts";
import { ChartCard } from "./chart_card.tsx";
import { StatRows } from "./stat_rows.tsx";

const RECENT_PAUSES_SHOWN = 6;

export interface RedditTelemetryPayload {
  telemetry: RedditTelemetryState;
  snapshot: RedditFunnelSnapshot;
  maintenancePaused: boolean;
}

export function RedditFunnelCard({ data }: { data: RedditTelemetryPayload }) {
  const { telemetry, snapshot, maintenancePaused } = data;
  const now = Date.now();

  const lastHour = sumWindow(telemetry, now, 1);
  const lastDay = sumWindow(telemetry, now, 24);

  return (
    <ChartCard
      title="Reddit funnel"
      subtitle="every Reddit request the extension makes flows through here"
    >
      <div>
        <StatRows
          rows={[
            ["Rate budget", describeBudget(telemetry, now)],
            ["Paused", describePause(snapshot, now)],
            [
              "Queue",
              `${snapshot.mainRunning + snapshot.mainQueued} interactive · ${
                snapshot.backgroundRunning + snapshot.backgroundQueued
              } background`,
            ],
            [
              "Background maintenance",
              maintenancePaused ? "paused in Settings" : "running",
            ],
            ["Requests last hour", describeTally(lastHour)],
            ["Requests last 24h", describeTally(lastDay)],
          ]}
        />
        {telemetry.pauses.length > 0 && (
          <RecentPauses pauses={telemetry.pauses} />
        )}
      </div>
    </ChartCard>
  );
}

function sumWindow(
  telemetry: RedditTelemetryState,
  now: number,
  hours: number
): { ok: number; error: number } {
  const firstHour = Math.floor(now / MS_PER_HOUR) - (hours - 1);
  const out = { ok: 0, error: 0 };

  for (const bucket of telemetry.hourly) {
    if (bucket.hour < firstHour) {
      continue;
    }

    for (const tally of Object.values(bucket.counts)) {
      out.ok += tally.ok;
      out.error += tally.error;
    }
  }

  return out;
}

function describeTally(tally: { ok: number; error: number }): string {
  const total = tally.ok + tally.error;

  if (total === 0) {
    return "none";
  }

  return tally.error > 0 ? `${total} · ${tally.error} failed` : String(total);
}

function describeBudget(telemetry: RedditTelemetryState, now: number): string {
  const budget = telemetry.lastBudget;

  if (budget === null) {
    return "no sample yet";
  }

  // A sample past its own reset says nothing about the current window.
  if (budget.resetAt <= now) {
    return `fresh window (was ${budget.remaining} at ${formatDate(budget.at)})`;
  }

  return `${budget.remaining} remaining · resets ${formatDate(budget.resetAt)}`;
}

function describePause(snapshot: RedditFunnelSnapshot, now: number): string {
  if (snapshot.pausedUntil !== null && snapshot.pausedUntil > now) {
    return `all traffic until ${formatDate(snapshot.pausedUntil)}`;
  }

  if (
    snapshot.backgroundPausedUntil !== null &&
    snapshot.backgroundPausedUntil > now
  ) {
    return `background only, until ${formatDate(snapshot.backgroundPausedUntil)}`;
  }

  return "no";
}

function RecentPauses({ pauses }: { pauses: RedditTelemetryState["pauses"] }) {
  const recent = pauses.slice(-RECENT_PAUSES_SHOWN).reverse();

  return (
    <ul class="bon-sweep-list">
      {recent.map((pause) => (
        <li key={pause.at}>
          <span>{pause.reason}</span>
          <span class="bon-sweep-when">
            {formatDate(pause.at)} · {fmtDuration(pause.durationMs)}
            {pause.backgroundOnly ? " · background only" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
