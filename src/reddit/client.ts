// Single funnel for every background-side fetch against reddit.com. Two
// p-queues cap in-flight requests across all callers so they don't 429
// each other or the operator's own logged-in Reddit tab: interactive/bulk
// work shares a concurrency-capped queue, while background hygiene traffic
// (sweeps, attribution) trickles through its own one-at-a-time queue on a
// fixed interval. Per-feature queues (investigation concurrency,
// attribution drain) still gate *what work to schedule*; this only gates
// *how many HTTP calls are in flight*.
//
// Rate-limit defense:
//   1. Proactive floor-trip off Reddit's `x-ratelimit-*` response headers.
//      When `remaining` drops to REDDIT_BUDGET_FLOOR, pause both queues
//      until the bucket resets — preempts the 429 we'd otherwise eat. At
//      REDDIT_BACKGROUND_RESERVE, only the background queue pauses, so
//      hygiene passes can never eat the headroom interactive work and the
//      operator's own session need.
//   2. Reactive pause on 429 / 5xx — both queues halt dispatch until the
//      cooldown elapses. State is mirrored to browser.storage.local under
//      `redditPauseUntil` so UI surfaces can show a banner via
//      storage.onChanged.
//
// Every request is tagged with the feature that issued it; per-source
// tallies, pause events, and the last-seen budget are folded into the
// `redditTelemetry` storage slice (debounced) for the metrics tab.

import PQueue from "p-queue";

import { QUEUE_PRIORITY } from "../queue_priority.ts";
import { shortUrl } from "../utils/format_text.ts";
import { clampRetryAfter, parseRetryAfter } from "../utils/retry_after.ts";
import {
  readRedditPauseUntil,
  readRedditTelemetry,
  writeRedditPauseUntil,
  writeRedditTelemetry,
} from "../storage";
import {
  emptyRedditTelemetry,
  telemetryRecordBudget,
  telemetryRecordFetch,
  telemetryRecordPause,
} from "./telemetry.ts";
import type {
  RedditBudgetSample,
  RedditSource,
  RedditTelemetryState,
} from "./telemetry.ts";

const REDDIT_CONCURRENCY = 4;

// Reddit usually answers in well under a second. A 30s ceiling means a
// hung connection releases its slot instead of stalling the queue.
const REDDIT_FETCH_TIMEOUT_MS = 30_000;

const REDDIT_BUDGET_FLOOR = 3;

// Below this many remaining requests, background traffic yields the rest
// of the budget window to interactive work and the operator's own session.
const REDDIT_BACKGROUND_RESERVE = 20;

// Background requests dispatch at most one per interval — a sweep's burst
// of probes drains as a trickle instead of a spike.
const REDDIT_BACKGROUND_INTERVAL_MS = 5_000;

const TELEMETRY_FLUSH_DELAY_MS = 2_000;

interface RedditBudget {
  remaining: number;
  resetAt: number;
}

export interface RedditRequestOptions {
  source: RedditSource;
  priority?: number;
}

export interface RedditFunnelSnapshot {
  mainQueued: number;
  mainRunning: number;
  backgroundQueued: number;
  backgroundRunning: number;
  pausedUntil: number | null;
  backgroundPausedUntil: number | null;
}

const queue = new PQueue({ concurrency: REDDIT_CONCURRENCY });

const backgroundQueue = new PQueue({
  concurrency: 1,
  interval: REDDIT_BACKGROUND_INTERVAL_MS,
  intervalCap: 1,
});

let pausedUntil: number | null = null;
let pauseClearTimer: ReturnType<typeof setTimeout> | null = null;

let backgroundPausedUntil: number | null = null;
let backgroundPauseClearTimer: ReturnType<typeof setTimeout> | null = null;

let telemetry: RedditTelemetryState | null = null;
let telemetryLoad: Promise<void> | null = null;
let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;

// Serializes access to the single in-memory telemetry instance: the mutation
// runs synchronously once the stored state is loaded, so concurrent record
// calls can't clobber each other.
async function withTelemetry(
  mutate: (state: RedditTelemetryState) => void
): Promise<void> {
  if (telemetry === null) {
    if (telemetryLoad === null) {
      telemetryLoad = readRedditTelemetry()
        .then((stored) => {
          telemetry ??= stored;
        })
        .catch((error) => {
          console.error("[Bot or Not] failed to load Reddit telemetry", error);
          telemetry ??= emptyRedditTelemetry();
        });
    }

    await telemetryLoad;
  }

  mutate(telemetry!);
  scheduleTelemetryFlush();
}

function scheduleTelemetryFlush(): void {
  if (telemetryFlushTimer !== null) {
    return;
  }

  telemetryFlushTimer = setTimeout(() => {
    telemetryFlushTimer = null;
    void flushTelemetry();
  }, TELEMETRY_FLUSH_DELAY_MS);
}

async function flushTelemetry(): Promise<void> {
  if (telemetry === null) {
    return;
  }

  try {
    await writeRedditTelemetry(telemetry);
  } catch (error) {
    console.error("[Bot or Not] failed to persist Reddit telemetry", error);
  }
}

function recordPauseEvent(
  reason: string,
  durationMs: number,
  backgroundOnly: boolean
): void {
  void withTelemetry((state) => {
    telemetryRecordPause(state, {
      at: Date.now(),
      reason,
      durationMs,
      budgetRemaining: state.lastBudget?.remaining ?? null,
      backgroundOnly,
    });
  }).then(() => {
    // Pause events are rare and exactly what the operator wants to see —
    // don't sit on them for the debounce window.
    if (telemetryFlushTimer !== null) {
      clearTimeout(telemetryFlushTimer);
      telemetryFlushTimer = null;
    }

    void flushTelemetry();
  });
}

async function publishPauseState(): Promise<void> {
  try {
    await writeRedditPauseUntil(pausedUntil);
  } catch (error) {
    console.error("[Bot or Not] failed to broadcast Reddit pause state", error);
  }
}

function clearPause(): void {
  pausedUntil = null;
  if (pauseClearTimer !== null) {
    clearTimeout(pauseClearTimer);
    pauseClearTimer = null;
  }

  queue.start();

  if (backgroundPausedUntil === null) {
    backgroundQueue.start();
  }

  void publishPauseState();
}

function notePause(retryAfterMs: number | null, reason: string): void {
  const delay = clampRetryAfter(retryAfterMs ?? 0);
  const newPausedUntil = Date.now() + delay;

  if (pausedUntil !== null && pausedUntil >= newPausedUntil) {
    return;
  }

  pausedUntil = newPausedUntil;
  queue.pause();
  backgroundQueue.pause();

  if (pauseClearTimer !== null) {
    clearTimeout(pauseClearTimer);
  }

  pauseClearTimer = setTimeout(clearPause, delay);
  console.warn(
    `[Bot or Not] Reddit ${reason}; pausing all fetches for ${Math.round(delay / 1000)}s`
  );

  recordPauseEvent(reason, delay, false);
  void publishPauseState();
}

function clearBackgroundPause(): void {
  backgroundPausedUntil = null;
  if (backgroundPauseClearTimer !== null) {
    clearTimeout(backgroundPauseClearTimer);
    backgroundPauseClearTimer = null;
  }

  if (pausedUntil === null) {
    backgroundQueue.start();
  }
}

function noteBackgroundPause(retryAfterMs: number, reason: string): void {
  const delay = clampRetryAfter(retryAfterMs);
  const newPausedUntil = Date.now() + delay;

  if (
    backgroundPausedUntil !== null &&
    backgroundPausedUntil >= newPausedUntil
  ) {
    return;
  }

  backgroundPausedUntil = newPausedUntil;
  backgroundQueue.pause();

  if (backgroundPauseClearTimer !== null) {
    clearTimeout(backgroundPauseClearTimer);
  }

  backgroundPauseClearTimer = setTimeout(clearBackgroundPause, delay);
  console.warn(
    `[Bot or Not] Reddit ${reason}; pausing background fetches for ${Math.round(delay / 1000)}s`
  );

  recordPauseEvent(reason, delay, true);
}

function parseBudget(headers: Headers): RedditBudget | null {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const resetRaw = headers.get("x-ratelimit-reset");
  if (remainingRaw === null || resetRaw === null) {
    return null;
  }

  const remaining = Number(remainingRaw);
  const resetSec = Number(resetRaw);
  if (!Number.isFinite(remaining) || !Number.isFinite(resetSec)) {
    return null;
  }

  return {
    remaining: Math.max(0, Math.floor(remaining)),
    resetAt: Date.now() + Math.max(0, resetSec) * 1000,
  };
}

function noteBudget(headers: Headers): void {
  const budget = parseBudget(headers);
  if (budget === null) {
    return;
  }

  const sample: RedditBudgetSample = {
    remaining: budget.remaining,
    resetAt: budget.resetAt,
    at: Date.now(),
  };

  void withTelemetry((state) => {
    telemetryRecordBudget(state, sample);
  });

  const resetMs = Math.max(0, budget.resetAt - Date.now());

  if (budget.remaining <= REDDIT_BUDGET_FLOOR) {
    notePause(resetMs, `budget at ${budget.remaining} remaining`);
  } else if (budget.remaining <= REDDIT_BACKGROUND_RESERVE) {
    noteBackgroundPause(
      resetMs,
      `budget at ${budget.remaining} remaining (background reserve)`
    );
  }
}

export class RedditRequestError extends Error {
  httpStatus: number | null;
  retryAfterMs: number | null;

  constructor(
    message: string,
    httpStatus: number | null,
    retryAfterMs: number | null
  ) {
    super(message);
    this.name = "RedditRequestError";
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

async function bootstrapPauseState(): Promise<void> {
  try {
    const stored = await readRedditPauseUntil();

    if (stored === null) {
      return;
    }

    const remaining = stored - Date.now();
    if (remaining <= 0) {
      await writeRedditPauseUntil(null);
      return;
    }

    pausedUntil = stored;
    queue.pause();
    backgroundQueue.pause();
    pauseClearTimer = setTimeout(clearPause, remaining);
  } catch (error) {
    console.error("[Bot or Not] failed to restore Reddit pause state", error);
  }
}

void bootstrapPauseState();

// Live view of the funnel for the metrics tab; persisted telemetry rides
// alongside it in the `get-reddit-telemetry` response.
export function redditFunnelSnapshot(): RedditFunnelSnapshot {
  return {
    mainQueued: queue.size,
    mainRunning: queue.pending,
    backgroundQueued: backgroundQueue.size,
    backgroundRunning: backgroundQueue.pending,
    pausedUntil,
    backgroundPausedUntil,
  };
}

export async function redditFetchJson<T = unknown>(
  url: string,
  options: RedditRequestOptions
): Promise<T> {
  return await enqueueRequest<T>(url, {}, options);
}

// Form-encoded POST to a legacy `/api/*` write endpoint. Rides the same
// queue as the reads so writes count against the shared rate budget.
export async function redditPostForm<T = unknown>(
  url: string,
  form: Record<string, string>,
  options: RedditRequestOptions
): Promise<T> {
  return await enqueueRequest<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    },
    options
  );
}

async function enqueueRequest<T>(
  url: string,
  init: RequestInit,
  options: RedditRequestOptions
): Promise<T> {
  const priority = options.priority ?? QUEUE_PRIORITY.bulk;
  const targetQueue =
    priority <= QUEUE_PRIORITY.background ? backgroundQueue : queue;

  return await targetQueue.add(
    async () => {
      const startedAt = performance.now();
      let succeeded = false;

      try {
        const response = await fetch(url, {
          ...init,
          headers: { Accept: "application/json", ...init.headers },
          credentials: "include",
          signal: AbortSignal.timeout(REDDIT_FETCH_TIMEOUT_MS),
        });

        noteBudget(response.headers);

        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(
            response.headers.get("Retry-After")
          );

          if (response.status === 429) {
            notePause(retryAfterMs, "rate-limited");
          } else if (response.status >= 500) {
            notePause(retryAfterMs, `returned ${response.status}`);
          }

          throw new RedditRequestError(
            `Reddit fetch ${response.status} for ${url}`,
            response.status,
            retryAfterMs
          );
        }

        const body = (await response.json()) as T;
        succeeded = true;
        return body;
      } finally {
        void withTelemetry((state) => {
          telemetryRecordFetch(state, options.source, succeeded, Date.now());
        });

        const elapsedMs = Math.round(performance.now() - startedAt);
        const suffix = succeeded ? "" : " (failed)";
        console.log(
          `[Bot or Not] timing: fetch ${shortUrl(url)} ${elapsedMs}ms${suffix}`
        );
      }
    },
    { priority }
  );
}
