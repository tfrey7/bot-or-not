// Background-context handlers for investigation lifecycle. The pure
// pipeline (Reddit fetch → Claude → verdict) lives in `./index.ts`; this
// file wraps it with the storage I/O that persists per-run state into the
// matching Report record.
//
// Architecture:
//   - Storage is the durable record of *what* investigations exist and what
//     state they're in (queued / running / done / error). UI reads here.
//   - PQueue is the transient dispatcher capping concurrency at
//     INVESTIGATION_CONCURRENCY. p-retry handles per-attempt retries +
//     Retry-After cooldowns. Both vanish on service-worker eviction.
//   - On startup, hydrate re-enqueues anything in a non-terminal state.

import PQueue from "p-queue";
import pRetry, { AbortError } from "p-retry";

import type {
  Investigation,
  InvestigationResults,
  RedditMetrics,
  Report,
  RunSnapshot,
} from "../../types.ts";
import {
  readApiKey,
  readLlmSelection,
  readReport,
  readReports,
  updateReport,
  writeReports,
} from "../../storage.ts";
import {
  findReportKey,
  normalizeReport,
  snapshotRun,
} from "../../utils/history.ts";
import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import {
  HIDDEN_PROFILE_MODEL,
  isProfileHidden,
} from "../../utils/profile_hidden.ts";
import { clampRetryAfter } from "../../utils/retry_after.ts";
import { isInvestigationStale } from "../../verdict.ts";
import {
  extractSnoovatarUrl,
  gatherProfile,
  runOneDAnalysis,
  RedditFetchError,
  type GatheredProfile,
} from "./index.ts";
const AUTO_INVESTIGATE_FRESHNESS_MS = 60 * 60 * 1000;

// Shown as the investigation summary when a hidden profile is parked without
// running the analyzer — see runOneAttempt.
const HIDDEN_PROFILE_SUMMARY =
  "This profile is hidden — almost nothing is public despite an established account, so there's not enough to analyze. Harvest a Google dossier for this user (search their username on Google), then re-run the investigation.";

// Reddit throttling is handled globally by the shared Reddit client. This
// cap just controls how many investigations overlap their Claude calls.
export const INVESTIGATION_CONCURRENCY = 3;

const INVESTIGATION_MAX_ATTEMPTS = 4;

const queue = new PQueue({ concurrency: INVESTIGATION_CONCURRENCY });

// Guard against double-enqueue. investigationStart and the hydrate path
// both try to enqueue; this Set lets either fail fast if the other got
// there first.
const inFlight = new Set<string>();

// Re-enqueue any investigation that didn't reach a terminal state. Both
// "queued" and "running" records get re-run — the "running" ones are
// orphans from a previous worker that died mid-await.
export async function investigationSweepOrphans(): Promise<void> {
  try {
    const reports = await readReports();

    for (const [username, report] of Object.entries(reports)) {
      const investigation = report.investigation;
      if (!investigation) {
        continue;
      }

      if (
        investigation.status === "queued" ||
        investigation.status === "running"
      ) {
        void enqueueInvestigation(username, QUEUE_PRIORITY.bulk);
      }
    }
  } catch (error) {
    console.error("[Bot or Not] hydrate failed", error);
  }
}

export async function investigationStart(
  username: string
): Promise<{ ok: boolean; queued?: boolean; error?: string }> {
  if (!username) {
    return { ok: false, error: "missing username" };
  }

  const selection = await readLlmSelection();
  const vendor = selection.vendor ?? "anthropic";
  const apiKey = await readApiKey(vendor);

  if (!apiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const key = username.toLowerCase();
  if (inFlight.has(key)) {
    return { ok: true, queued: true };
  }

  const existing = (await readReport(username))?.investigation;

  // Already queued or running — don't bump position by overwriting
  // queuedAt; just make sure something has it enqueued.
  if (existing?.status === "queued" || existing?.status === "running") {
    void enqueueInvestigation(username, QUEUE_PRIORITY.interactive);
    return { ok: true, queued: true };
  }

  await setInvestigationState(username, {
    status: "queued",
    queuedAt: Date.now(),
    priority: QUEUE_PRIORITY.interactive,
    attempts: 0,
  });
  void enqueueInvestigation(username, QUEUE_PRIORITY.interactive);

  return { ok: true, queued: queue.pending >= INVESTIGATION_CONCURRENCY };
}

// Bulk enqueue. Collapses N×{read,read,write} of the full reports object
// into a single read-modify-write — important when something like the
// subreddit-analyze flow enqueues ~100 users in one burst. Each write
// fires browser.storage.onChanged on every subscriber, so the savings
// compound across the UI surfaces too.
export async function investigationStartBatch(
  usernames: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (usernames.length === 0) {
    return { ok: true };
  }

  const selection = await readLlmSelection();
  const vendor = selection.vendor ?? "anthropic";
  const apiKey = await readApiKey(vendor);

  if (!apiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const reports = await readReports();
  const toEnqueue: string[] = [];
  let dirty = false;
  const now = Date.now();

  for (const username of usernames) {
    if (!username) {
      continue;
    }

    const key = findReportKey(reports, username) ?? username;
    const existing = reports[key] ?? normalizeReport(undefined);
    const prevInvestigation = existing.investigation;

    // Already queued/running: skip the storage stamp (mirrors the
    // single-user shortcut in investigationStart). Still re-enqueue
    // into PQueue in case the in-memory queue lost it.
    if (
      prevInvestigation?.status === "queued" ||
      prevInvestigation?.status === "running"
    ) {
      toEnqueue.push(username);
      continue;
    }

    const seedFromLegacy =
      prevInvestigation?.status === "done" &&
      (prevInvestigation.runs?.length ?? 0) === 0;
    const prevRuns: RunSnapshot[] = seedFromLegacy
      ? [snapshotRun(prevInvestigation, "done")]
      : (prevInvestigation?.runs ?? []);

    reports[key] = {
      ...existing,
      investigation: {
        status: "queued",
        queuedAt: now,
        priority: QUEUE_PRIORITY.bulk,
        notBefore: null,
        startedAt: null,
        durationMs: null,
        error: null,
        attempts: 0,
        runs: prevRuns,
        redditMetrics: prevInvestigation?.redditMetrics ?? null,
        results: null,
      },
    };
    dirty = true;
    toEnqueue.push(username);
  }

  if (dirty) {
    await writeReports(reports);
  }

  for (const username of toEnqueue) {
    void enqueueInvestigation(username, QUEUE_PRIORITY.bulk);
  }

  return { ok: true };
}

async function enqueueInvestigation(
  username: string,
  priority: number
): Promise<void> {
  const key = username.toLowerCase();
  if (inFlight.has(key)) {
    return;
  }

  inFlight.add(key);

  try {
    await queue.add(() => runInvestigationLifecycle(username, priority), {
      priority,
    });
  } finally {
    inFlight.delete(key);
  }
}

async function runInvestigationLifecycle(
  username: string,
  priority: number
): Promise<void> {
  const selection = await readLlmSelection();
  const vendor = selection.vendor ?? "anthropic";
  const apiKey = await readApiKey(vendor);
  if (!apiKey) {
    await setInvestigationState(username, {
      status: "error",
      error: "no-api-key",
      durationMs: null,
    });

    return;
  }

  const lifecycleStartedAt = Date.now();

  try {
    await pRetry(
      async (attemptNumber) => {
        const attemptStartedAt = Date.now();
        await setInvestigationState(username, {
          status: "running",
          startedAt: attemptStartedAt,
          attempts: attemptNumber,
        });

        try {
          await runOneAttempt(username, apiKey, attemptStartedAt, priority);
        } catch (error) {
          // 404 means the username doesn't exist — no retry will help.
          if (error instanceof RedditFetchError && error.httpStatus === 404) {
            throw new AbortError(error as Error);
          }

          throw error;
        }
      },
      {
        retries: INVESTIGATION_MAX_ATTEMPTS - 1,

        // Custom delay handled in onFailedAttempt.
        minTimeout: 0,
        maxTimeout: 0,

        // 429 / 5xx are upstream-load signals, not investigation failures.
        // Refund the attempt so a Reddit outage can't burn the operator's
        // retry budget — the Reddit client's global pause handles waiting.
        shouldConsumeRetry: ({ error }) => !isUpstreamLoad(error),

        onFailedAttempt: async ({ error, attemptNumber }) => {
          const retryAfterMs = readRetryAfterMs(error);
          const delayMs = clampRetryAfter(
            retryAfterMs ?? defaultBackoffMs(attemptNumber)
          );
          const notBefore = Date.now() + delayMs;
          const message = String(
            (error as { message?: string })?.message ?? error
          );
          const accountedAttempts = isUpstreamLoad(error)
            ? attemptNumber - 1
            : attemptNumber;

          console.warn(
            `[Bot or Not] investigation ${username} failed (attempt ${accountedAttempts}/${INVESTIGATION_MAX_ATTEMPTS}); retrying after ${Math.round(delayMs / 1000)}s: ${message}`
          );

          await setInvestigationState(username, {
            status: "queued",
            queuedAt: Date.now(),
            notBefore,
            attempts: accountedAttempts,
            durationMs: Date.now() - lifecycleStartedAt,
            ...redditMetricsPatch(error),
          });

          await delay(delayMs);
        },
      }
    );
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    const durationMs = Date.now() - lifecycleStartedAt;

    console.error(`[Bot or Not] investigation ${username} failed:`, error);

    await setInvestigationState(username, {
      status: "error",
      error: message,
      durationMs,
      ...redditMetricsPatch(error),
    });
  }
}

async function runOneAttempt(
  username: string,
  apiKey: string,
  startedAt: number,
  priority: number
): Promise<void> {
  const existingRecord =
    (await readReport(username)) ?? normalizeReport(undefined);

  const inputs = await gatherProfile(
    username,
    {
      ...(existingRecord.botBouncerStatus
        ? { botBouncerStatus: existingRecord.botBouncerStatus }
        : {}),
      ...(existingRecord.botBouncerCheckedAt
        ? { botBouncerCheckedAt: existingRecord.botBouncerCheckedAt }
        : {}),
      ...(existingRecord.googleHarvest
        ? { googleHarvest: existingRecord.googleHarvest }
        : {}),
      ...(existingRecord.passiveHarvest
        ? { passiveHarvest: existingRecord.passiveHarvest }
        : {}),
    },
    priority
  );

  const postsFetched = inputs.raw.submitted.data?.children?.length ?? 0;
  const commentsFetched = inputs.raw.comments.data?.children?.length ?? 0;
  const hidden = isProfileHidden({
    postsFetched,
    commentsFetched,
    totalKarma: inputs.summary.account.total_karma,
  });

  // A hidden profile exposes almost nothing through Reddit's API. Until the
  // operator harvests a Google dossier there's nothing for the analyzer to
  // work from, so skip the Claude call and park the report at "uncertain".
  const hasDossier = (existingRecord.googleHarvest?.posts.length ?? 0) > 0;
  if (hidden && !hasDossier) {
    const results = hiddenProfileResults(
      inputs,
      postsFetched,
      commentsFetched,
      startedAt
    );
    await persistInvestigationDone(username, inputs, results, hidden);
    return;
  }

  const selection = await readLlmSelection();
  const analysis = await runOneDAnalysis(
    apiKey,
    inputs.summary,
    extractSnoovatarUrl(inputs.raw),
    selection
  );

  const durationMs = Date.now() - startedAt;
  console.log(`[Bot or Not] timing: investigation ${username} ${durationMs}ms`);

  const results: InvestigationResults = {
    runAt: analysis.runAt,
    durationMs,
    verdict: analysis.verdict,
    confidence: analysis.confidence,
    botProbability: analysis.botProbability,
    factors: analysis.factors,
    persona: analysis.persona,
    region: analysis.region,
    demographics: analysis.demographics,
    summary: analysis.summary,
    model: analysis.model,
    usage: analysis.usage,
    costUsd: analysis.costUsd,
    postsFetched,
    commentsFetched,
    accountCreatedAt: inputs.summary.account.created_at,
    accountAgeDays: inputs.summary.account.age_days,
  };

  await persistInvestigationDone(username, inputs, results, hidden);
}

// Synthetic results for a hidden profile we declined to analyze. Empty
// factors keep computeVerdict pinned at "uncertain"; the summary tells the
// operator to harvest a dossier and re-run.
function hiddenProfileResults(
  inputs: GatheredProfile,
  postsFetched: number,
  commentsFetched: number,
  startedAt: number
): InvestigationResults {
  return {
    runAt: Date.now(),
    durationMs: Date.now() - startedAt,
    verdict: "uncertain",
    confidence: 0,
    botProbability: 0.5,
    factors: [],
    persona: null,
    region: null,
    demographics: null,
    summary: HIDDEN_PROFILE_SUMMARY,
    model: HIDDEN_PROFILE_MODEL,
    usage: null,
    costUsd: null,
    postsFetched,
    commentsFetched,
    accountCreatedAt: inputs.summary.account.created_at,
    accountAgeDays: inputs.summary.account.age_days,
  };
}

// One write for the whole terminal state. Splitting it (investigation +
// activityData + botBouncer + profileHidden) into separate updateReports
// would fire storage.onChanged four times, re-rendering every Reddit tag
// and the reports page on each.
async function persistInvestigationDone(
  username: string,
  inputs: GatheredProfile,
  results: InvestigationResults,
  hidden: boolean
): Promise<void> {
  await updateReport(username, (current) => {
    let next = applyInvestigationTransition(
      current ?? normalizeReport(undefined),
      {
        status: "done",
        durationMs: results.durationMs,
        results,
        redditMetrics: inputs.redditMetrics,
      }
    );

    if (inputs.activityData) {
      next = { ...next, activityData: inputs.activityData };
    }

    if (
      inputs.botBouncerStatus &&
      next.botBouncerStatus !== inputs.botBouncerStatus
    ) {
      next = {
        ...next,
        botBouncerStatus: inputs.botBouncerStatus,
        botBouncerCheckedAt: Date.now(),
      };
    }

    if (next.profileHidden !== hidden) {
      next = { ...next, profileHidden: hidden };
    }

    return next;
  });
}

function isUpstreamLoad(error: unknown): boolean {
  if (!(error instanceof RedditFetchError)) {
    return false;
  }

  const status = error.httpStatus;
  return status === 429 || (status !== null && status >= 500);
}

function readRetryAfterMs(error: unknown): number | null {
  const value = (error as { retryAfterMs?: number | null } | null)
    ?.retryAfterMs;

  return typeof value === "number" && value > 0 ? value : null;
}

function defaultBackoffMs(attemptNumber: number): number {
  return Math.min(30_000, 1_000 * 2 ** (attemptNumber - 1));
}

function redditMetricsPatch(
  error: unknown
): { redditMetrics: RedditMetrics } | Record<string, never> {
  return error instanceof RedditFetchError
    ? { redditMetrics: error.metrics }
    : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Viewing someone's profile is itself a signal of suspicion — kick off an
// investigation when one isn't already on file. Stale "running" is treated
// as no-investigation since a previous worker died mid-await. Done / error /
// fresh-running are left alone; the user can retry errors via the panel.
export async function investigationAutoOnView(
  username: string
): Promise<{ ok: boolean; started?: boolean; error?: string }> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false, error: "missing-username" };
  }

  try {
    const selection = await readLlmSelection();
    const vendor = selection.vendor ?? "anthropic";
    const apiKey = await readApiKey(vendor);

    if (!apiKey) {
      return { ok: true, started: false };
    }

    const investigation = (await readReport(trimmed))?.investigation ?? null;

    if (
      investigation &&
      !(
        investigation.status === "running" &&
        isInvestigationStale(investigation)
      )
    ) {
      return { ok: true, started: false };
    }

    void investigationStart(trimmed);
    return { ok: true, started: true };
  } catch (error) {
    console.error("[Bot or Not] auto-investigate-on-view failed", error);
    return {
      ok: false,
      error: String((error as { message?: string })?.message ?? error),
    };
  }
}

// Triggered when a user gets re-reported. Re-runs the investigation unless
// one is already running or a fresh result is on file.
export async function investigationMaybeAuto(username: string): Promise<void> {
  try {
    const selection = await readLlmSelection();
    const vendor = selection.vendor ?? "anthropic";
    const apiKey = await readApiKey(vendor);

    if (!apiKey) {
      return;
    }

    const investigation = (await readReport(username))?.investigation ?? null;

    if (
      investigation?.status === "running" &&
      !isInvestigationStale(investigation)
    ) {
      return;
    }

    if (investigation?.status === "queued") {
      return;
    }

    if (
      investigation?.status === "done" &&
      Date.now() - investigation.results.runAt < AUTO_INVESTIGATE_FRESHNESS_MS
    ) {
      return;
    }

    await investigationStart(username);
  } catch (error) {
    console.error("[Bot or Not] auto-investigate failed", error);
  }
}

// Transition descriptors for setInvestigationState. Each variant lists the
// fields the caller is responsible for; the helper layers them onto the
// prev investigation's lifecycle fields (attempts/runs etc).
type InvestigationTransition =
  | {
      status: "queued";
      queuedAt: number;
      priority?: number;
      notBefore?: number | null;
      durationMs?: number | null;
      attempts?: number;
      redditMetrics?: RedditMetrics | null;
    }
  | {
      status: "running";
      startedAt: number;
      attempts: number;
    }
  | {
      status: "done";
      durationMs: number;
      results: InvestigationResults;
      redditMetrics: RedditMetrics | null;
    }
  | {
      status: "error";
      error: string;
      durationMs: number | null;
      redditMetrics?: RedditMetrics | null;
    };

async function setInvestigationState(
  username: string,
  transition: InvestigationTransition
): Promise<void> {
  await updateReport(username, (current) =>
    applyInvestigationTransition(
      current ?? normalizeReport(undefined),
      transition
    )
  );
}

// Pure: layer a lifecycle transition onto a report's investigation, carrying
// forward attempts/runs/redditMetrics. Kept separate from the storage write
// so a terminal "done" can be bundled with activityData / botBouncer /
// profileHidden into one updateReport instead of four sequential writes —
// each write fires storage.onChanged across every tab.
function applyInvestigationTransition(
  existing: Report,
  transition: InvestigationTransition
): Report {
  const prevInvestigation = existing.investigation;

  const prevAttempts = prevInvestigation?.attempts ?? 0;
  const prevRedditMetrics = prevInvestigation?.redditMetrics ?? null;
  const prevPriority = prevInvestigation?.priority ?? QUEUE_PRIORITY.bulk;

  // Older records have only the single most-recent investigation stored —
  // seed runs[] from those fields the first time we touch one so historical
  // timing/cost data survives the next re-run. Must happen before the
  // transition writes a null `results`, otherwise the legacy data is lost.
  const seedFromLegacy =
    prevInvestigation?.status === "done" &&
    (prevInvestigation.runs?.length ?? 0) === 0;
  const prevRuns: RunSnapshot[] = seedFromLegacy
    ? [snapshotRun(prevInvestigation, "done")]
    : (prevInvestigation?.runs ?? []);

  let nextInvestigation: Investigation;
  switch (transition.status) {
    case "queued":
      nextInvestigation = {
        status: "queued",
        queuedAt: transition.queuedAt,
        priority: transition.priority ?? prevPriority,
        notBefore: transition.notBefore ?? null,
        startedAt: null,
        durationMs: transition.durationMs ?? null,
        error: null,
        attempts: transition.attempts ?? prevAttempts,
        runs: prevRuns,
        redditMetrics: transition.redditMetrics ?? prevRedditMetrics,
        results: null,
      };
      break;
    case "running":
      nextInvestigation = {
        status: "running",
        queuedAt: null,
        priority: prevPriority,
        notBefore: null,
        startedAt: transition.startedAt,
        durationMs: prevInvestigation?.durationMs ?? null,
        error: null,
        attempts: transition.attempts,
        runs: prevRuns,
        redditMetrics: prevRedditMetrics,
        results: null,
      };
      break;
    case "done":
      nextInvestigation = {
        status: "done",
        queuedAt: prevInvestigation?.queuedAt ?? null,
        priority: prevPriority,
        notBefore: null,
        startedAt: null,
        durationMs: transition.durationMs,
        error: null,
        attempts: prevAttempts,
        runs: prevRuns,
        redditMetrics: transition.redditMetrics,
        results: transition.results,
      };
      break;
    case "error":
      nextInvestigation = {
        status: "error",
        queuedAt: prevInvestigation?.queuedAt ?? null,
        priority: prevPriority,
        notBefore: null,
        startedAt: null,
        durationMs: transition.durationMs,
        error: transition.error,
        attempts: prevAttempts,
        runs: prevRuns,
        redditMetrics: transition.redditMetrics ?? prevRedditMetrics,
        results: null,
      };
      break;
  }

  // Append a snapshot to runs[] whenever a run terminates.
  if (
    prevInvestigation?.status === "running" &&
    (transition.status === "done" || transition.status === "error")
  ) {
    nextInvestigation.runs = [
      ...prevRuns,
      snapshotRun(nextInvestigation, transition.status),
    ];
  }

  return { ...existing, investigation: nextInvestigation };
}
