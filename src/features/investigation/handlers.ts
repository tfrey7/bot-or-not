// Background-context handlers for investigation lifecycle. The pure
// pipeline (Reddit fetch → Claude → verdict) lives in `./index.ts`; this
// file wraps it with the storage I/O that persists per-run state into the
// matching Report record.

import type { ActivityData, Investigation, Report } from "../../types.ts";
import {
  bonFindReportKey,
  bonFreshInvestigation,
  bonNormalizeReport,
  bonReadReports,
  bonSnapshotRun,
  bonWriteReports,
} from "../../utils/history.ts";
import { bonIsProfileHidden } from "../../utils/profile_hidden.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import {
  bonExtractSnoovatarUrl,
  bonGatherProfile,
  bonRunOneDAnalysis,
  RedditFetchError,
} from "./index.ts";

const BON_AUTO_INVESTIGATE_FRESHNESS_MS = 60 * 60 * 1000;
export const BON_INVESTIGATION_CONCURRENCY = 2;

// One initial attempt + 3 retries. Counts every time we transition to
// "running" — so a worker that dies mid-await still spent an attempt.
const BON_INVESTIGATION_MAX_ATTEMPTS = 4;

// In-memory set of usernames currently executing the Reddit + Claude
// pipeline. Bounded by BON_INVESTIGATION_CONCURRENCY so Reddit doesn't
// throttle us when a burst of investigations is requested. Queue position
// is derived from storage (status: "queued" records ordered by queuedAt)
// so a worker eviction doesn't lose pending items.
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
              ...investigation,
              status: "queued",
              queuedAt: now,
              startedAt: null,
              error: null,
              durationMs,
            },
          };
          hasQueued = true;
        } else {
          reports[username] = {
            ...report,
            investigation: {
              ...investigation,
              status: "error",
              startedAt: null,
              error: "interrupted before completion",
              durationMs,
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

  const { claudeApiKey = "" } = (await browser.storage.local.get(
    "claudeApiKey"
  )) as { claudeApiKey?: string };

  if (!claudeApiKey) {
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
      startedAt: null,
      error: null,
      attempts: 0,
    });

    return { ok: true, queued: true };
  }

  void runInvestigation(username, claudeApiKey, { resetAttempts: true });
  return { ok: true, queued: false };
}

async function runInvestigation(
  username: string,
  claudeApiKey: string,
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
    queuedAt: null,
    startedAt,
    error: null,
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
    const analysis = await bonRunOneDAnalysis(
      claudeApiKey,
      inputs.summary,
      bonExtractSnoovatarUrl(inputs.raw)
    );

    const durationMs = Date.now() - startedAt;
    console.log(
      `[Bot or Not] timing: investigation ${username} ${durationMs}ms`
    );

    const sharedFields = {
      postsFetched: inputs.raw.submitted.data?.children?.length ?? 0,
      commentsFetched: inputs.raw.comments.data?.children?.length ?? 0,
      accountCreatedAt: inputs.summary.account.created_at,
      accountAgeDays: inputs.summary.account.age_days,
      redditMetrics: inputs.redditMetrics,
    };

    await setInvestigationState(username, {
      status: "done",
      startedAt: null,
      error: null,
      durationMs,
      ...analysis,
      ...sharedFields,
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
        postsFetched: sharedFields.postsFetched,
        commentsFetched: sharedFields.commentsFetched,
        totalKarma: inputs.summary.account.total_karma,
      })
    );
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    const durationMs = Date.now() - startedAt;
    const redditMetricsPatch =
      error instanceof RedditFetchError ? { redditMetrics: error.metrics } : {};

    if (attempts < BON_INVESTIGATION_MAX_ATTEMPTS) {
      console.warn(
        `[Bot or Not] investigation ${username} failed (attempt ${attempts}/${BON_INVESTIGATION_MAX_ATTEMPTS}); re-queueing: ${message}`
      );

      await setInvestigationState(username, {
        status: "queued",
        queuedAt: Date.now(),
        startedAt: null,
        error: null,
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
        startedAt: null,
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

// After a run finishes, pull the oldest queued record (by queuedAt) and
// kick it. Loop because freeing one slot may admit more than one record
// if other slots are also idle.
async function drainQueue(): Promise<void> {
  if (activeRuns.size >= BON_INVESTIGATION_CONCURRENCY) {
    return;
  }

  try {
    const { claudeApiKey = "" } = (await browser.storage.local.get(
      "claudeApiKey"
    )) as { claudeApiKey?: string };

    if (!claudeApiKey) {
      return;
    }

    const reports = await bonReadReports();
    const queued: Array<{ username: string; queuedAt: number }> = [];

    for (const [username, report] of Object.entries(reports)) {
      const investigation = report.investigation;
      if (investigation?.status !== "queued") {
        continue;
      }

      if (activeRuns.has(username.toLowerCase())) {
        continue;
      }

      queued.push({
        username,
        queuedAt: investigation.queuedAt ?? 0,
      });
    }

    queued.sort((a, b) => a.queuedAt - b.queuedAt);

    for (const { username } of queued) {
      if (activeRuns.size >= BON_INVESTIGATION_CONCURRENCY) {
        return;
      }

      void runInvestigation(username, claudeApiKey);
    }
  } catch (error) {
    console.error("[Bot or Not] drainQueue failed", error);
  }
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
    const { claudeApiKey = "" } = (await browser.storage.local.get(
      "claudeApiKey"
    )) as { claudeApiKey?: string };

    if (!claudeApiKey) {
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
    const { claudeApiKey = "" } = (await browser.storage.local.get(
      "claudeApiKey"
    )) as { claudeApiKey?: string };

    if (!claudeApiKey) {
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
      investigation?.runAt &&
      Date.now() - investigation.runAt < BON_AUTO_INVESTIGATE_FRESHNESS_MS
    ) {
      return;
    }

    await bonInvestigationStart(username);
  } catch (error) {
    console.error("[Bot or Not] auto-investigate failed", error);
  }
}

async function setInvestigationState(
  username: string,
  patch: Partial<Investigation> & { status: Investigation["status"] }
): Promise<void> {
  const reports = await bonReadReports();

  // Create the record on first investigation so users who haven't been
  // reported yet still get tracked.
  const key = bonFindReportKey(reports, username) ?? username;
  const existing = reports[key] ?? bonNormalizeReport(undefined);
  const prevInvestigation = existing.investigation;
  const nextInvestigation: Investigation = {
    ...bonFreshInvestigation(patch.status),
    ...(prevInvestigation ?? {}),
    ...patch,
  };

  // Append a snapshot to runs[] whenever a run terminates. Older records have
  // only the single most-recent investigation stored — seed runs[] from those
  // fields on the first re-run so historical timing/cost data survives.
  const completing =
    prevInvestigation?.status === "running" &&
    (patch.status === "done" || patch.status === "error");

  if (completing && prevInvestigation) {
    const seeded =
      prevInvestigation.runs.length === 0 &&
      prevInvestigation.runAt !== null &&
      prevInvestigation.durationMs !== null
        ? [bonSnapshotRun(prevInvestigation, "done")]
        : prevInvestigation.runs;

    nextInvestigation.runs = [
      ...seeded,
      bonSnapshotRun(nextInvestigation, patch.status),
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

// Inlined rather than calling into reports/handlers.ts so the two feature
// directories don't form an import cycle. Same shape as
// bonReportsSetBotBouncerStatus — keep them in sync if the field semantics
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
