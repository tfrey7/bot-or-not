// Background-context handlers for investigation lifecycle. The pure
// pipeline (Reddit fetch → Claude → verdict) lives in `./index.ts`; this
// file wraps it with the storage I/O that persists per-run state into the
// matching Report record.

import type {
  ActivityData,
  Investigation,
  InvestigationResults,
  RedditMetrics,
  Report,
  RunSnapshot,
} from "../../types.ts";
import { bonRedditGetPausedUntil } from "../../reddit/client.ts";
import {
  bonReadApiKey,
  bonReadLlmSelection,
  bonReadReports,
  bonWriteReports,
} from "../../storage.ts";
import {
  bonFindReportKey,
  bonNormalizeReport,
  bonSnapshotRun,
} from "../../utils/history.ts";
import { bonIsProfileHidden } from "../../utils/profile_hidden.ts";
import { bonClampRetryAfter } from "../../utils/retry_after.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import {
  bonExtractSnoovatarUrl,
  bonGatherProfile,
  bonRunOneDAnalysis,
  RedditFetchError,
} from "./index.ts";

const BON_AUTO_INVESTIGATE_FRESHNESS_MS = 60 * 60 * 1000;

// Reddit throttling is handled globally by the shared Reddit client
// (src/reddit/client.ts) — its in-flight semaphore is the real backstop.
// This cap just controls how many investigations overlap their Claude
// calls (the bulk of wall-clock time once Reddit fetches are bounded).
export const BON_INVESTIGATION_CONCURRENCY = 5;

// One initial attempt + 3 retries. Counts every time we transition to
// "running" — so a worker that dies mid-await still spent an attempt.
const BON_INVESTIGATION_MAX_ATTEMPTS = 4;

// In-memory set of usernames currently executing the Reddit + Claude
// pipeline. Queue position is derived from storage (status: "queued"
// records ordered by queuedAt) so a worker eviction doesn't lose
// pending items.
const activeRuns = new Set<string>();

// Investigations stuck at status: "running" at startup are orphaned — a
// previous background-script instance died mid-await (web-ext reload,
// browser restart, service-worker eviction) and its completion handler
// never fired. If they have retries left, drop them back into "queued"
// (at the tail) so drainQueue picks them up; otherwise they fall to
// "error". Anything already "queued" just needs drainQueue to be poked.
export async function bonInvestigationSweepOrphans(): Promise<void> {
  try {
    const reports = await bonReadReports();

    let changed = false;
    let hasQueued = false;
    const now = Date.now();

    for (const [username, report] of Object.entries(reports)) {
      const investigation = report.investigation;
      if (!investigation) {
        continue;
      }

      if (investigation.status === "running") {
        const canRetry =
          investigation.attempts < BON_INVESTIGATION_MAX_ATTEMPTS;
        const durationMs = investigation.startedAt
          ? now - investigation.startedAt
          : null;

        if (canRetry) {
          reports[username] = {
            ...report,
            investigation: {
              status: "queued",
              queuedAt: now,
              notBefore: null,
              startedAt: null,
              durationMs,
              error: null,
              attempts: investigation.attempts,
              runs: investigation.runs,
              redditMetrics: investigation.redditMetrics,
              results: null,
            },
          };
          hasQueued = true;
        } else {
          reports[username] = {
            ...report,
            investigation: {
              status: "error",
              queuedAt: investigation.queuedAt,
              notBefore: null,
              startedAt: null,
              durationMs,
              error: "interrupted before completion",
              attempts: investigation.attempts,
              runs: investigation.runs,
              redditMetrics: investigation.redditMetrics,
              results: null,
            },
          };
        }

        changed = true;
      } else if (investigation.status === "queued") {
        hasQueued = true;
      }
    }

    if (changed) {
      await bonWriteReports(reports);
      console.log("[Bot or Not] swept orphaned investigations");
    }

    if (hasQueued) {
      void drainQueue();
    }
  } catch (error) {
    console.error("[Bot or Not] orphan sweep failed", error);
  }
}

export async function bonInvestigationStart(
  username: string
): Promise<{ ok: boolean; queued?: boolean; error?: string }> {
  if (!username) {
    return { ok: false, error: "missing username" };
  }

  const selection = await bonReadLlmSelection();
  const vendor = selection.vendor ?? "anthropic";
  const apiKey = await bonReadApiKey(vendor);

  if (!apiKey) {
    return { ok: false, error: "no-api-key" };
  }

  if (activeRuns.has(username.toLowerCase())) {
    return { ok: true, queued: false };
  }

  const reports = await bonReadReports();
  const existing =
    reports[bonFindReportKey(reports, username) ?? username]?.investigation;

  // Already in line — don't bump its position to the back by overwriting
  // queuedAt. Callers like the re-report path lean on this idempotency.
  if (existing?.status === "queued") {
    return { ok: true, queued: true };
  }

  if (activeRuns.size >= BON_INVESTIGATION_CONCURRENCY) {
    await setInvestigationState(username, {
      status: "queued",
      queuedAt: Date.now(),
      attempts: 0,
    });

    return { ok: true, queued: true };
  }

  void runInvestigation(username, apiKey, { resetAttempts: true });
  return { ok: true, queued: false };
}

async function runInvestigation(
  username: string,
  apiKey: string,
  options: { resetAttempts?: boolean } = {}
): Promise<void> {
  const key = username.toLowerCase();
  activeRuns.add(key);

  const startedAt = Date.now();

  const reportsForAttempts = await bonReadReports();
  const attemptsBefore = options.resetAttempts
    ? 0
    : (reportsForAttempts[
        bonFindReportKey(reportsForAttempts, username) ?? username
      ]?.investigation?.attempts ?? 0);
  const attempts = attemptsBefore + 1;

  await setInvestigationState(username, {
    status: "running",
    startedAt,
    attempts,
  });

  try {
    const latestReports = await bonReadReports();
    const existingRecord =
      latestReports[bonFindReportKey(latestReports, username) ?? username] ??
      bonNormalizeReport(undefined);

    const inputs = await bonGatherProfile(username, {
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
    });
    const selection = await bonReadLlmSelection();
    const analysis = await bonRunOneDAnalysis(
      apiKey,
      inputs.summary,
      bonExtractSnoovatarUrl(inputs.raw),
      selection
    );

    const durationMs = Date.now() - startedAt;
    console.log(
      `[Bot or Not] timing: investigation ${username} ${durationMs}ms`
    );

    const postsFetched = inputs.raw.submitted.data?.children?.length ?? 0;
    const commentsFetched = inputs.raw.comments.data?.children?.length ?? 0;

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

    await setInvestigationState(username, {
      status: "done",
      durationMs,
      results,
      redditMetrics: inputs.redditMetrics,
    });

    if (inputs.activityData) {
      await saveActivityData(username, inputs.activityData);
    }

    if (inputs.botBouncerStatus) {
      await persistBotBouncerStatus(username, inputs.botBouncerStatus);
    }

    await setProfileHidden(
      username,
      bonIsProfileHidden({
        postsFetched,
        commentsFetched,
        totalKarma: inputs.summary.account.total_karma,
      })
    );
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    const durationMs = Date.now() - startedAt;
    const redditMetricsPatch =
      error instanceof RedditFetchError ? { redditMetrics: error.metrics } : {};

    // 404 on the about endpoint = the username doesn't exist. Retrying
    // won't conjure them, so short-circuit to a terminal error instead
    // of burning attempts.
    const isUserNotFound =
      error instanceof RedditFetchError && error.httpStatus === 404;

    // 429 is a load signal, not an investigation-specific failure. Refund
    // the attempt so a rate-limit storm can't burn the operator's whole
    // retry budget. The Reddit client's global pause handles the wait.
    const isRateLimited =
      error instanceof RedditFetchError && error.httpStatus === 429;
    const accountedAttempts = isRateLimited ? attempts - 1 : attempts;

    if (!isUserNotFound && accountedAttempts < BON_INVESTIGATION_MAX_ATTEMPTS) {
      const retryAfterMs = readRetryAfterMs(error);
      const notBefore = retryAfterMs
        ? Date.now() + bonClampRetryAfter(retryAfterMs)
        : null;
      const pauseSuffix = notBefore
        ? ` (paused until ${new Date(notBefore).toLocaleTimeString()})`
        : "";

      console.warn(
        `[Bot or Not] investigation ${username} failed (attempt ${accountedAttempts}/${BON_INVESTIGATION_MAX_ATTEMPTS}); re-queueing${pauseSuffix}: ${message}`
      );

      await setInvestigationState(username, {
        status: "queued",
        queuedAt: Date.now(),
        notBefore,
        attempts: accountedAttempts,
        durationMs,
        ...redditMetricsPatch,
      });
    } else {
      console.error(
        `[Bot or Not] investigation ${username} failed after ${attempts} attempts:`,
        error
      );

      await setInvestigationState(username, {
        status: "error",
        error: message,
        durationMs,
        ...redditMetricsPatch,
      });
    }
  } finally {
    activeRuns.delete(key);
    void drainQueue();
  }
}

// Pending wake timer for the next paused-queued record's notBefore. Only
// one is ever scheduled — drainQueue cancels and re-arms each pass so we
// always wait for the *soonest* pause to elapse.
let pauseWakeTimer: ReturnType<typeof setTimeout> | null = null;

// After a run finishes, pull the oldest queued record (by queuedAt) and
// kick it. Records whose notBefore is in the future are skipped, and the
// soonest of those is scheduled to re-drain when its cooldown elapses.
async function drainQueue(): Promise<void> {
  if (activeRuns.size >= BON_INVESTIGATION_CONCURRENCY) {
    return;
  }

  const globalPauseUntil = bonRedditGetPausedUntil();
  if (globalPauseUntil !== null) {
    scheduleQueueWake(globalPauseUntil);
    return;
  }

  try {
    const selection = await bonReadLlmSelection();
    const vendor = selection.vendor ?? "anthropic";
    const apiKey = await bonReadApiKey(vendor);

    if (!apiKey) {
      return;
    }

    const reports = await bonReadReports();
    const now = Date.now();
    const eligible: Array<{ username: string; queuedAt: number }> = [];
    let nextPauseElapsesAt: number | null = null;

    for (const [username, report] of Object.entries(reports)) {
      const investigation = report.investigation;
      if (investigation?.status !== "queued") {
        continue;
      }

      if (activeRuns.has(username.toLowerCase())) {
        continue;
      }

      const notBefore = investigation.notBefore ?? null;
      if (notBefore !== null && notBefore > now) {
        if (nextPauseElapsesAt === null || notBefore < nextPauseElapsesAt) {
          nextPauseElapsesAt = notBefore;
        }

        continue;
      }

      eligible.push({
        username,
        queuedAt: investigation.queuedAt ?? 0,
      });
    }

    eligible.sort((a, b) => a.queuedAt - b.queuedAt);

    for (const { username } of eligible) {
      if (activeRuns.size >= BON_INVESTIGATION_CONCURRENCY) {
        break;
      }

      void runInvestigation(username, apiKey);
    }

    scheduleQueueWake(nextPauseElapsesAt);
  } catch (error) {
    console.error("[Bot or Not] drainQueue failed", error);
  }
}

function scheduleQueueWake(elapsesAt: number | null): void {
  if (pauseWakeTimer !== null) {
    clearTimeout(pauseWakeTimer);
    pauseWakeTimer = null;
  }

  if (elapsesAt === null) {
    return;
  }

  const delayMs = Math.max(0, elapsesAt - Date.now());
  pauseWakeTimer = setTimeout(() => {
    pauseWakeTimer = null;
    void drainQueue();
  }, delayMs);
}

function readRetryAfterMs(error: unknown): number | null {
  const value = (error as { retryAfterMs?: number | null } | null)
    ?.retryAfterMs;

  return typeof value === "number" && value > 0 ? value : null;
}

// Viewing someone's profile is itself a signal of suspicion — kick off an
// investigation when one isn't already on file. Stale "running" is treated
// as no-investigation since a previous worker died mid-await. Done / error /
// fresh-running are left alone; the user can retry errors via the panel.
export async function bonInvestigationAutoOnView(
  username: string
): Promise<{ ok: boolean; started?: boolean; error?: string }> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false, error: "missing-username" };
  }

  try {
    const selection = await bonReadLlmSelection();
    const vendor = selection.vendor ?? "anthropic";
    const apiKey = await bonReadApiKey(vendor);

    if (!apiKey) {
      return { ok: true, started: false };
    }

    const reports = await bonReadReports();
    const key = bonFindReportKey(reports, trimmed) ?? trimmed;
    const investigation = bonNormalizeReport(reports[key]).investigation;

    if (
      investigation &&
      !(
        investigation.status === "running" &&
        bonIsInvestigationStale(investigation)
      )
    ) {
      return { ok: true, started: false };
    }

    void bonInvestigationStart(trimmed);
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
export async function bonInvestigationMaybeAuto(
  username: string
): Promise<void> {
  try {
    const selection = await bonReadLlmSelection();
    const vendor = selection.vendor ?? "anthropic";
    const apiKey = await bonReadApiKey(vendor);

    if (!apiKey) {
      return;
    }

    const reports = await bonReadReports();
    const key = bonFindReportKey(reports, username) ?? username;
    const investigation = bonNormalizeReport(reports[key]).investigation;

    if (
      investigation?.status === "running" &&
      !bonIsInvestigationStale(investigation)
    ) {
      return;
    }

    if (investigation?.status === "queued") {
      return;
    }

    if (
      investigation?.status === "done" &&
      Date.now() - investigation.results.runAt <
        BON_AUTO_INVESTIGATE_FRESHNESS_MS
    ) {
      return;
    }

    await bonInvestigationStart(username);
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
  const reports = await bonReadReports();

  // Create the record on first investigation so users who haven't been
  // reported yet still get tracked.
  const key = bonFindReportKey(reports, username) ?? username;
  const existing = reports[key] ?? bonNormalizeReport(undefined);
  const prevInvestigation = existing.investigation;

  const prevAttempts = prevInvestigation?.attempts ?? 0;
  const prevRedditMetrics = prevInvestigation?.redditMetrics ?? null;

  // Older records have only the single most-recent investigation stored —
  // seed runs[] from those fields the first time we touch one so historical
  // timing/cost data survives the next re-run. Must happen before the
  // transition writes a null `results`, otherwise the legacy data is lost.
  const seedFromLegacy =
    prevInvestigation?.status === "done" &&
    (prevInvestigation.runs?.length ?? 0) === 0;
  const prevRuns: RunSnapshot[] = seedFromLegacy
    ? [bonSnapshotRun(prevInvestigation, "done")]
    : (prevInvestigation?.runs ?? []);

  let nextInvestigation: Investigation;
  switch (transition.status) {
    case "queued":
      nextInvestigation = {
        status: "queued",
        queuedAt: transition.queuedAt,
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
      bonSnapshotRun(nextInvestigation, transition.status),
    ];
  }

  reports[key] = { ...existing, investigation: nextInvestigation };
  await bonWriteReports(reports);
}

async function saveActivityData(
  username: string,
  activityData: ActivityData
): Promise<void> {
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username) ?? username;
  const existing = reports[key] ?? bonNormalizeReport(undefined);
  reports[key] = { ...existing, activityData };
  await bonWriteReports(reports);
}

// Flips report.profileHidden whenever an investigation completes. The
// passive-harvest content script reads this flag to decide which
// usernames to scrape from the DOM as the operator browses — only the
// hidden ones, since visible accounts can be re-fetched via the Reddit
// API on the next investigation.
async function setProfileHidden(
  username: string,
  hidden: boolean
): Promise<void> {
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username) ?? username;
  const existing = reports[key] ?? bonNormalizeReport(undefined);

  if (existing.profileHidden === hidden) {
    return;
  }

  reports[key] = { ...existing, profileHidden: hidden };
  await bonWriteReports(reports);
}

// Inlined rather than calling into redditors/handlers.ts so the two feature
// directories don't form an import cycle. Same shape as
// bonRedditorsSetBotBouncerStatus — keep them in sync if the field semantics
// change.
async function persistBotBouncerStatus(
  username: string,
  status: Report["botBouncerStatus"]
): Promise<void> {
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username);
  if (!key) {
    return;
  }

  const existing = reports[key];
  if (existing.botBouncerStatus === status) {
    return;
  }

  reports[key] = {
    ...existing,
    botBouncerStatus: status,
    botBouncerCheckedAt: Date.now(),
  };
  await bonWriteReports(reports);
}
