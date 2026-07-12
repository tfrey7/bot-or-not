// Telemetry bookkeeping for the Reddit funnel: hourly per-source request
// tallies, a ring of rate-limit pause events, and the last-seen budget
// headers. Pure transforms over the state object — no DOM, no I/O. The
// helpers mutate the passed state in place; the funnel (reddit/client.ts)
// owns a single in-memory instance and flushes it to storage debounced.

export type RedditSource =
  | "investigation"
  | "subreddit"
  | "attribution"
  | "status-recheck"
  | "blocklist";

export interface RedditSourceTally {
  ok: number;
  error: number;
}

// `hour` is an epoch-hour index (epoch-ms / 1h, floored).
export interface RedditHourlyBucket {
  hour: number;
  counts: Partial<Record<RedditSource, RedditSourceTally>>;
}

export interface RedditPauseEvent {
  at: number;
  reason: string;
  durationMs: number;
  budgetRemaining: number | null;
  backgroundOnly: boolean;
}

export interface RedditBudgetSample {
  remaining: number;
  resetAt: number;
  at: number;
}

export interface RedditTelemetryState {
  hourly: RedditHourlyBucket[];
  pauses: RedditPauseEvent[];
  lastBudget: RedditBudgetSample | null;
}

export const MS_PER_HOUR = 3_600_000;

const HOURLY_BUCKET_CAP = 7 * 24;
const PAUSE_RING_CAP = 50;

export function emptyRedditTelemetry(): RedditTelemetryState {
  return { hourly: [], pauses: [], lastBudget: null };
}

export function telemetryRecordFetch(
  state: RedditTelemetryState,
  source: RedditSource,
  ok: boolean,
  now: number
): void {
  const hour = Math.floor(now / MS_PER_HOUR);
  let bucket = state.hourly[state.hourly.length - 1];

  if (!bucket || bucket.hour !== hour) {
    bucket = { hour, counts: {} };
    state.hourly.push(bucket);

    if (state.hourly.length > HOURLY_BUCKET_CAP) {
      state.hourly.splice(0, state.hourly.length - HOURLY_BUCKET_CAP);
    }
  }

  const tally = bucket.counts[source] ?? { ok: 0, error: 0 };

  if (ok) {
    tally.ok += 1;
  } else {
    tally.error += 1;
  }

  bucket.counts[source] = tally;
}

export function telemetryRecordPause(
  state: RedditTelemetryState,
  event: RedditPauseEvent
): void {
  state.pauses.push(event);

  if (state.pauses.length > PAUSE_RING_CAP) {
    state.pauses.splice(0, state.pauses.length - PAUSE_RING_CAP);
  }
}

export function telemetryRecordBudget(
  state: RedditTelemetryState,
  sample: RedditBudgetSample
): void {
  state.lastBudget = sample;
}
