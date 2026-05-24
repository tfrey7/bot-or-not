// Single funnel for every background-side fetch against reddit.com. A
// shared semaphore caps in-flight requests across all callers so they
// don't 429 each other or the operator's own logged-in Reddit tab.
// Per-feature queues (investigation concurrency, attribution drain) still
// gate *what work to schedule*; this only gates *how many HTTP calls are
// in flight*.
//
// Two layers of rate-limit defense:
//   1. Proactive pacing off Reddit's `x-ratelimit-*` response headers.
//      Once the budget tightens (see BON_REDDIT_BUDGET_COMFORTABLE),
//      drainWaiters spaces dispatch evenly across the remaining window so
//      we walk up to the boundary instead of sprinting into it. When the
//      budget hits the floor we proactively trip the pause without
//      waiting for a 429.
//   2. Reactive pause on 429 / 5xx — every subsequent fetch blocks until
//      the cooldown elapses. State is mirrored to browser.storage.local
//      under `redditPauseUntil` so UI surfaces can show a banner via the
//      standard storage.onChanged path.

import { bonShortUrl } from "../utils/format_text.ts";
import {
  bonClampRetryAfter,
  bonParseRetryAfter,
} from "../utils/retry_after.ts";

const BON_REDDIT_CONCURRENCY = 4;

// Reddit usually answers in well under a second. A 30s ceiling means a
// hung connection releases its semaphore slot instead of stalling the
// whole queue behind one dead request.
const BON_REDDIT_FETCH_TIMEOUT_MS = 30_000;

// Proactive-pacing thresholds, driven by Reddit's `x-ratelimit-*` response
// headers. Reddit gives cookie-authenticated browser fetches ~100 requests
// per 10-minute window. We let dispatch run flat-out while there's headroom
// and switch to evenly-spread pacing once the budget tightens, so a burst
// (e.g. a 100-author subreddit analysis = ~500 fetches) doesn't sprint into
// a 429 it could have walked around.
const BON_REDDIT_BUDGET_COMFORTABLE = 30;
const BON_REDDIT_BUDGET_FLOOR = 3;
const BON_REDDIT_PACE_SAFETY_FACTOR = 1.2;

interface BonRedditBudget {
  remaining: number;
  resetAt: number;
}

let latestBudget: BonRedditBudget | null = null;
let nextAllowedAt = 0;

let inFlight = 0;
const waiters: Array<() => void> = [];
let drainTimer: ReturnType<typeof setTimeout> | null = null;

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

  void publishPauseState();
  drainWaiters();
}

function scheduleDrain(delayMs: number): void {
  if (drainTimer !== null) {
    clearTimeout(drainTimer);
  }

  drainTimer = setTimeout(
    () => {
      drainTimer = null;
      drainWaiters();
    },
    Math.max(0, delayMs)
  );
}

function drainWaiters(): void {
  if (drainTimer !== null) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }

  while (waiters.length > 0) {
    if (pausedUntil !== null && pausedUntil > Date.now()) {
      scheduleDrain(pausedUntil - Date.now());
      return;
    }

    if (inFlight >= BON_REDDIT_CONCURRENCY) {
      return;
    }

    const now = Date.now();
    if (now < nextAllowedAt) {
      scheduleDrain(nextAllowedAt - now);
      return;
    }

    const next = waiters.shift();
    if (!next) {
      return;
    }

    inFlight += 1;
    nextAllowedAt = Math.max(nextAllowedAt, now) + currentSpacingMs();
    next();
  }
}

function currentSpacingMs(): number {
  if (latestBudget === null) {
    return 0;
  }

  if (latestBudget.remaining >= BON_REDDIT_BUDGET_COMFORTABLE) {
    return 0;
  }

  const msUntilReset = Math.max(0, latestBudget.resetAt - Date.now());
  const denominator = Math.max(1, latestBudget.remaining);
  return (msUntilReset / denominator) * BON_REDDIT_PACE_SAFETY_FACTOR;
}

function parseBudget(headers: Headers): BonRedditBudget | null {
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

function notePause(retryAfterMs: number | null, reason: string): void {
  const delay = bonClampRetryAfter(retryAfterMs ?? 0);
  const newPausedUntil = Date.now() + delay;

  if (pausedUntil !== null && pausedUntil >= newPausedUntil) {
    return;
  }

  pausedUntil = newPausedUntil;

  if (pauseClearTimer !== null) {
    clearTimeout(pauseClearTimer);
  }

  pauseClearTimer = setTimeout(clearPause, delay);
  console.warn(
    `[Bot or Not] Reddit ${reason}; pausing all fetches for ${Math.round(delay / 1000)}s`
  );

  void publishPauseState();
}

export function bonRedditGetPausedUntil(): number | null {
  if (pausedUntil !== null && pausedUntil <= Date.now()) {
    clearPause();
  }

  return pausedUntil;
}

function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    drainWaiters();
  });
}

export function bonRedditGetBudget(): BonRedditBudget | null {
  if (latestBudget === null) {
    return null;
  }

  if (latestBudget.resetAt <= Date.now()) {
    latestBudget = null;
    return null;
  }

  return latestBudget;
}

function noteBudget(headers: Headers): void {
  const budget = parseBudget(headers);
  if (budget === null) {
    return;
  }

  latestBudget = budget;

  if (budget.remaining <= BON_REDDIT_BUDGET_FLOOR) {
    const resetMs = Math.max(0, budget.resetAt - Date.now());
    notePause(resetMs, `budget at ${budget.remaining} remaining`);
  }
}

function releaseSlot(): void {
  inFlight -= 1;
  drainWaiters();
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
    pauseClearTimer = setTimeout(clearPause, remaining);
  } catch (error) {
    console.error("[Bot or Not] failed to restore Reddit pause state", error);
  }
}

void bootstrapPauseState();

export async function bonRedditFetchJson<T = unknown>(url: string): Promise<T> {
  await acquireSlot();

  const startedAt = performance.now();
  let succeeded = false;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: AbortSignal.timeout(BON_REDDIT_FETCH_TIMEOUT_MS),
    });

    noteBudget(response.headers);

    if (!response.ok) {
      const retryAfterMs = bonParseRetryAfter(
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
      `[Bot or Not] timing: fetch ${bonShortUrl(url)} ${elapsedMs}ms${suffix}`
    );
    releaseSlot();
  }
}
