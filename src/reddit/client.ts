// Single funnel for every background-side fetch against reddit.com. A
// shared semaphore caps in-flight requests across all callers so they
// don't 429 each other or the operator's own logged-in Reddit tab.
// Per-feature queues (investigation concurrency, attribution drain) still
// gate *what work to schedule*; this only gates *how many HTTP calls are
// in flight*.
//
// Also owns the global rate-limit pause: when Reddit returns a 429, every
// subsequent fetch through this client blocks until Retry-After elapses.
// State is mirrored to browser.storage.local under `redditPauseUntil` so
// UI surfaces can show a banner via the standard storage.onChanged path.

import { bonShortUrl } from "../utils/format_text.ts";
import {
  bonClampRetryAfter,
  bonParseRetryAfter,
} from "../utils/retry_after.ts";

const BON_REDDIT_CONCURRENCY = 4;

let inFlight = 0;
const waiters: Array<() => void> = [];

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

function drainWaiters(): void {
  if (pausedUntil !== null && pausedUntil > Date.now()) {
    return;
  }

  while (inFlight < BON_REDDIT_CONCURRENCY && waiters.length > 0) {
    const next = waiters.shift();
    if (next) {
      inFlight += 1;
      next();
    }
  }
}

function noteRateLimit(retryAfterMs: number | null): void {
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
    `[Bot or Not] Reddit rate-limited; pausing all fetches for ${Math.round(delay / 1000)}s`
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
  const remainingPause =
    pausedUntil !== null ? Math.max(0, pausedUntil - Date.now()) : 0;

  if (remainingPause === 0 && inFlight < BON_REDDIT_CONCURRENCY) {
    inFlight += 1;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
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
    });

    if (!response.ok) {
      const retryAfterMs = bonParseRetryAfter(
        response.headers.get("Retry-After")
      );

      if (response.status === 429) {
        noteRateLimit(retryAfterMs);
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
