// Single funnel for every background-side fetch against reddit.com. A
// shared p-queue caps in-flight requests across all callers so they
// don't 429 each other or the operator's own logged-in Reddit tab.
// Per-feature queues (investigation concurrency, attribution drain) still
// gate *what work to schedule*; this only gates *how many HTTP calls are
// in flight*.
//
// Rate-limit defense:
//   1. Proactive floor-trip off Reddit's `x-ratelimit-*` response headers.
//      When `remaining` drops to REDDIT_BUDGET_FLOOR, pause the queue
//      until the bucket resets — preempts the 429 we'd otherwise eat.
//   2. Reactive pause on 429 / 5xx — `queue.pause()` halts dispatch until
//      the cooldown elapses, then `queue.start()` resumes. State is
//      mirrored to browser.storage.local under `redditPauseUntil` so UI
//      surfaces can show a banner via storage.onChanged.

import PQueue from "p-queue";

import { QUEUE_PRIORITY } from "../queue_priority.ts";
import { shortUrl } from "../utils/format_text.ts";
import { clampRetryAfter, parseRetryAfter } from "../utils/retry_after.ts";

const REDDIT_CONCURRENCY = 4;

// Reddit usually answers in well under a second. A 30s ceiling means a
// hung connection releases its slot instead of stalling the queue.
const REDDIT_FETCH_TIMEOUT_MS = 30_000;

const REDDIT_BUDGET_FLOOR = 3;

interface RedditBudget {
  remaining: number;
  resetAt: number;
}

const queue = new PQueue({ concurrency: REDDIT_CONCURRENCY });

let latestBudget: RedditBudget | null = null;
let pausedUntil: number | null = null;
let pauseClearTimer: ReturnType<typeof setTimeout> | null = null;

async function publishPauseState(): Promise<void> {
  try {
    if (pausedUntil === null) {
      await browser.storage.local.remove("redditPauseUntil");
    } else {
      await browser.storage.local.set({ redditPauseUntil: pausedUntil });
    }
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

  if (pauseClearTimer !== null) {
    clearTimeout(pauseClearTimer);
  }

  pauseClearTimer = setTimeout(clearPause, delay);
  console.warn(
    `[Bot or Not] Reddit ${reason}; pausing all fetches for ${Math.round(delay / 1000)}s`
  );

  void publishPauseState();
}

export function redditGetPausedUntil(): number | null {
  if (pausedUntil !== null && pausedUntil <= Date.now()) {
    clearPause();
  }

  return pausedUntil;
}

export function redditGetBudget(): RedditBudget | null {
  if (latestBudget === null) {
    return null;
  }

  if (latestBudget.resetAt <= Date.now()) {
    latestBudget = null;
    return null;
  }

  return latestBudget;
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

  latestBudget = budget;

  if (budget.remaining <= REDDIT_BUDGET_FLOOR) {
    const resetMs = Math.max(0, budget.resetAt - Date.now());
    notePause(resetMs, `budget at ${budget.remaining} remaining`);
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
    const raw = (await browser.storage.local.get("redditPauseUntil")) as {
      redditPauseUntil?: number;
    };
    const stored =
      typeof raw.redditPauseUntil === "number" ? raw.redditPauseUntil : null;

    if (stored === null) {
      return;
    }

    const remaining = stored - Date.now();
    if (remaining <= 0) {
      await browser.storage.local.remove("redditPauseUntil");
      return;
    }

    pausedUntil = stored;
    queue.pause();
    pauseClearTimer = setTimeout(clearPause, remaining);
  } catch (error) {
    console.error("[Bot or Not] failed to restore Reddit pause state", error);
  }
}

void bootstrapPauseState();

export async function redditFetchJson<T = unknown>(
  url: string,
  priority: number = QUEUE_PRIORITY.bulk
): Promise<T> {
  return await queue.add(
    async () => {
      const startedAt = performance.now();
      let succeeded = false;

      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
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
