import {
  bonAiCommandBuildSnapshot,
  bonRunAiCommand,
  type AiCommandMessage,
  type AiCommandResult,
} from "./features/ai-command";
import {
  bonExtractSnoovatarUrl,
  bonFetchUserActivity,
  bonGatherProfile,
  bonRunOneDAnalysis,
  RedditFetchError,
} from "./features/investigation";
import { bonReportsComputeRegionForReport } from "./features/reports/logic.ts";
import type { ActivityData, Investigation, Report } from "./types.ts";
import { bonExpectedDurationMs } from "./utils/expected_duration.ts";
import {
  bonDedupeHistory,
  bonFindReportKey,
  bonFreshInvestigation,
  bonNormalizeReport,
  bonReadReports,
  bonSnapshotRun,
  bonWriteReports,
} from "./utils/history.ts";
import { bonGenerateRingId } from "./utils/ring_id.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "./verdict.ts";

console.log("[Bot or Not] background loaded");

// In-memory conversation history for the AI command bar. Persists across
// `ai-command` calls but resets on service-worker eviction or extension
// reload — a hard cap on conversation length. The operator can also reset
// explicitly via `ai-command-reset`.
let aiCommandHistory: AiCommandMessage[] = [];

// Any investigation found with status: "running" at startup was orphaned —
// a previous background-script instance died mid-await (web-ext reload, browser
// restart, service worker eviction) and its completion handler never fired.
// Convert these to a clean error state so the UI shows them as failed rather
// than stuck on a spinner forever.
void sweepOrphanedInvestigations();

// One-time rename pass: the `crank` archetype was renamed to `zealot`.
// Rewrite stored investigations so the UI doesn't render stale labels.
void migrateCrankToZealot();

async function sweepOrphanedInvestigations(): Promise<void> {
  try {
    const reports = await bonReadReports();

    let changed = false;

    for (const [username, report] of Object.entries(reports)) {
      const investigation = report.investigation;
      if (investigation?.status !== "running") {
        continue;
      }

      reports[username] = {
        ...report,
        investigation: {
          ...investigation,
          status: "error",
          startedAt: null,
          error: "interrupted before completion",
          durationMs: investigation.startedAt
            ? Date.now() - investigation.startedAt
            : null,
        },
      };
      changed = true;
    }

    if (changed) {
      await bonWriteReports(reports);
      console.log("[Bot or Not] swept orphaned investigations");
    }
  } catch (error) {
    console.error("[Bot or Not] orphan sweep failed", error);
  }
}

async function migrateCrankToZealot(): Promise<void> {
  try {
    const reports = await bonReadReports();

    let changed = false;

    for (const [username, report] of Object.entries(reports)) {
      const persona = report.investigation?.persona;
      if (!persona) {
        continue;
      }

      const archetypes = persona.archetypes as Record<string, number> | null;
      const hasCrankArchetype = archetypes && "crank" in archetypes;
      const hasCrankLabel = (persona.label as string) === "crank";

      if (!hasCrankArchetype && !hasCrankLabel) {
        continue;
      }

      const nextArchetypes = hasCrankArchetype
        ? (() => {
            const { crank, ...rest } = archetypes;
            return { ...rest, zealot: crank } as Record<string, number>;
          })()
        : archetypes;

      reports[username] = {
        ...report,
        investigation: {
          ...report.investigation!,
          persona: {
            ...persona,
            label: hasCrankLabel ? "zealot" : persona.label,
            archetypes: nextArchetypes as typeof persona.archetypes,
          },
        },
      };
      changed = true;
    }

    if (changed) {
      await bonWriteReports(reports);
      console.log("[Bot or Not] migrated crank → zealot in stored personas");
    }
  } catch (error) {
    console.error("[Bot or Not] crank → zealot migration failed", error);
  }
}

interface BaseMessage {
  type: string;
  [k: string]: unknown;
}

browser.runtime.onMessage.addListener((message: BaseMessage) => {
  if (message.type === "report-user") {
    return handleReportUser(message);
  }

  if (message.type === "get-user-state") {
    return handleGetUserState(message);
  }

  if (message.type === "get-user-report") {
    return handleGetUserReport(message);
  }

  if (message.type === "get-user-tags") {
    return handleGetUserTags();
  }

  if (message.type === "get-all-reports") {
    return handleGetAllReports();
  }

  if (message.type === "update-user-status") {
    return handleUpdateUserStatus(message);
  }

  if (message.type === "update-user-profile-stats") {
    return handleUpdateUserProfileStats(message);
  }

  if (message.type === "update-post-status") {
    return handleUpdatePostStatus(message);
  }

  if (message.type === "update-botbouncer-status") {
    return handleUpdateBotBouncerStatus(message);
  }

  if (message.type === "clear-all-reports") {
    return handleClearAllReports();
  }

  if (message.type === "delete-report") {
    return handleDeleteReport(message);
  }

  if (message.type === "open-popup") {
    return handleOpenPopup();
  }

  if (message.type === "open-reports-tab") {
    return handleOpenReportsTab(message);
  }

  if (message.type === "investigate-user") {
    return handleInvestigateUser(message);
  }

  if (message.type === "auto-investigate-on-view") {
    return handleAutoInvestigateOnView(message);
  }

  if (message.type === "fetch-activity") {
    return handleFetchActivity(message);
  }

  if (message.type === "get-claude-api-key") {
    return handleGetClaudeApiKey();
  }

  if (message.type === "set-claude-api-key") {
    return handleSetClaudeApiKey(message);
  }

  if (message.type === "link-ring") {
    return handleLinkRing(message);
  }

  if (message.type === "unlink-ring") {
    return handleUnlinkRing(message);
  }

  if (message.type === "ai-command") {
    return handleAiCommand(message);
  }

  if (message.type === "ai-command-reset") {
    aiCommandHistory = [];
    return Promise.resolve({ ok: true });
  }
});

browser.action.onClicked.addListener(() => {
  void openReportsTab();
});

async function openReportsTab(username?: string): Promise<void> {
  const baseUrl = browser.runtime.getURL("src/reports.html");
  const targetUrl = username
    ? `${baseUrl}?user=${encodeURIComponent(username)}`
    : baseUrl;

  try {
    // Match any reports tab regardless of query string so the deep-link from
    // a profile reuses an already-open reports tab and navigates it to the
    // requested user.
    const existing = await browser.tabs.query({ url: `${baseUrl}*` });
    if (existing && existing.length > 0) {
      const tab = existing[0];
      if (tab.id != null) {
        const update: { active: true; url?: string } = { active: true };
        if (tab.url !== targetUrl) {
          update.url = targetUrl;
        }

        await browser.tabs.update(tab.id, update);
      }

      if (tab.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }

      return;
    }

    await browser.tabs.create({ url: targetUrl });
  } catch (error) {
    console.error("[Bot or Not] openReportsTab failed", error);
  }
}

async function handleOpenPopup(): Promise<void> {
  await openReportsTab();
}

async function handleOpenReportsTab(
  message: BaseMessage
): Promise<{ ok: true }> {
  const username =
    typeof message.username === "string" && message.username
      ? message.username
      : undefined;
  await openReportsTab(username);
  return { ok: true };
}

async function handleReportUser(
  message: BaseMessage
): Promise<{ count: number }> {
  const reports = await bonReadReports();

  const username = message.username as string;
  const existing = bonNormalizeReport(reports[username]);
  const reportedAt = Date.now();
  const entry = {
    at: reportedAt,
    ...((message.context as Record<string, unknown>) ?? {}),
  };
  const history = bonDedupeHistory([...existing.history, entry]);

  reports[username] = {
    ...existing,
    count: history.length,
    lastReportedAt: reportedAt,
    history,
  };
  await bonWriteReports(reports);

  void maybeAutoInvestigate(username);

  return { count: history.length };
}

const BON_AUTO_INVESTIGATE_FRESHNESS_MS = 60 * 60 * 1000;

async function maybeAutoInvestigate(username: string): Promise<void> {
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

    if (
      investigation?.runAt &&
      Date.now() - investigation.runAt < BON_AUTO_INVESTIGATE_FRESHNESS_MS
    ) {
      return;
    }

    await handleInvestigateUser({ type: "investigate-user", username });
  } catch (error) {
    console.error("[Bot or Not] auto-investigate failed", error);
  }
}

// Viewing someone's profile is itself a signal of suspicion — kick off an
// investigation when one isn't already on file. Stale "running" is treated as
// no-investigation since a previous worker died mid-await. Done/error/fresh-
// running are left alone; the user can retry errors via the panel button.
async function handleAutoInvestigateOnView(
  message: BaseMessage
): Promise<{ ok: boolean; started?: boolean; error?: string }> {
  const username = ((message.username as string) ?? "").trim();
  if (!username) {
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
    const key = bonFindReportKey(reports, username) ?? username;
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

    void handleInvestigateUser({ type: "investigate-user", username });
    return { ok: true, started: true };
  } catch (error) {
    console.error("[Bot or Not] auto-investigate-on-view failed", error);
    return {
      ok: false,
      error: String((error as { message?: string })?.message ?? error),
    };
  }
}

async function handleUpdateUserProfileStats(
  message: BaseMessage
): Promise<void> {
  const reports = await bonReadReports();
  const username = message.username as string;

  if (!reports[username]) {
    return;
  }

  const existing = reports[username];
  const incomingCreatedAt = message.createdAt as number | null;
  const incomingKarma = message.totalKarma as number | null;

  // Cake day is immutable, so only fill it when we don't already have one.
  // Karma changes over time — let the latest fetch win.
  const nextCreatedAt = existing.createdAt ?? incomingCreatedAt ?? null;
  const nextKarma = incomingKarma ?? existing.totalKarma ?? null;

  if (
    nextCreatedAt === existing.createdAt &&
    nextKarma === existing.totalKarma
  ) {
    return;
  }

  reports[username] = {
    ...existing,
    createdAt: nextCreatedAt,
    totalKarma: nextKarma,
  };
  await bonWriteReports(reports);
}

async function handleUpdateUserStatus(message: BaseMessage): Promise<void> {
  const reports = await bonReadReports();
  const username = message.username as string;

  // Only update users we've already reported
  if (!reports[username]) {
    return;
  }

  const existing = reports[username];
  if (existing.userStatus === message.status) {
    return;
  }

  reports[username] = {
    ...existing,
    userStatus: message.status as Report["userStatus"],
    userStatusCheckedAt: Date.now(),
  };
  await bonWriteReports(reports);
}

async function handleUpdateBotBouncerStatus(
  message: BaseMessage
): Promise<void> {
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, message.username as string);

  if (!key) {
    return;
  }

  const existing = reports[key];
  if (existing.botBouncerStatus === message.status) {
    return;
  }

  reports[key] = {
    ...existing,
    botBouncerStatus: message.status as Report["botBouncerStatus"],
    botBouncerCheckedAt: Date.now(),
  };
  await bonWriteReports(reports);
}

async function handleUpdatePostStatus(message: BaseMessage): Promise<void> {
  const reports = await bonReadReports();

  let updated = false;

  for (const [username, existing] of Object.entries(reports)) {
    let changed = false;

    const newHistory = existing.history.map((entry) => {
      if (
        entry.permalink &&
        entry.permalink === message.permalink &&
        entry.status !== message.status
      ) {
        changed = true;
        return {
          ...entry,
          status: message.status as string,
          statusCheckedAt: Date.now(),
        };
      }

      return entry;
    });

    if (changed) {
      reports[username] = { ...existing, history: newHistory };
      updated = true;
    }
  }

  if (updated) {
    await bonWriteReports(reports);
  }
}

interface UserTag {
  username: string;
  count: number;
  verdict: string | null;
  confidence: number | null;
  investigationStatus: string | null;
  investigationStartedAt: number | null;
  botBouncerStatus: string | null;
  userStatus: string | null;
  ringId: string | null;
}

async function handleGetUserTags(): Promise<{ tags: Record<string, UserTag> }> {
  const reports = await bonReadReports();

  const tags: Record<string, UserTag> = {};

  for (const [username, report] of Object.entries(reports)) {
    const tag = summarizeUserTag(username, report);
    if (tag) {
      tags[username] = tag;
    }
  }

  return { tags };
}

function summarizeUserTag(username: string, report: Report): UserTag | null {
  const investigation = bonNormalizeInvestigation(
    report.investigation,
    !!report.ringId
  );
  const verdict =
    investigation?.status === "done" ? investigation.verdict : null;
  const investigationStatus = investigation?.status ?? null;

  const hasSignal =
    verdict ||
    report.count > 0 ||
    report.userStatus ||
    report.botBouncerStatus ||
    report.ringId ||
    investigationStatus === "running";

  if (!hasSignal) {
    return null;
  }

  return {
    username,
    count: report.count,
    verdict,
    confidence: investigation?.confidence ?? null,
    investigationStatus,
    investigationStartedAt: investigation?.startedAt ?? null,
    botBouncerStatus: report.botBouncerStatus,
    userStatus: report.userStatus,
    ringId: report.ringId,
  };
}

async function handleGetAllReports(): Promise<{
  reports: Record<string, Report>;
}> {
  return { reports: await bonReadReports() };
}

async function handleClearAllReports(): Promise<{ ok: boolean }> {
  await bonWriteReports({});
  return { ok: true };
}

async function handleDeleteReport(
  message: BaseMessage
): Promise<{ ok: boolean; removed?: boolean; error?: string }> {
  const username = ((message.username as string) ?? "").trim();
  if (!username) {
    return { ok: false, error: "missing-username" };
  }

  const reports = await bonReadReports();
  if (!(username in reports)) {
    return { ok: true, removed: false };
  }

  delete reports[username];
  await bonWriteReports(reports);
  return { ok: true, removed: true };
}

async function handleGetClaudeApiKey(): Promise<{ hasKey: boolean }> {
  const { claudeApiKey = "" } = (await browser.storage.local.get(
    "claudeApiKey"
  )) as { claudeApiKey?: string };

  return { hasKey: !!claudeApiKey };
}

async function handleSetClaudeApiKey(
  message: BaseMessage
): Promise<{ ok: boolean; hasKey: boolean }> {
  const key = ((message.apiKey as string) || "").trim();
  if (!key) {
    await browser.storage.local.remove("claudeApiKey");
    return { ok: true, hasKey: false };
  }

  await browser.storage.local.set({ claudeApiKey: key });
  return { ok: true, hasKey: true };
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

async function handleInvestigateUser(
  message: BaseMessage
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const username = message.username as string;
  if (!username) {
    return { ok: false, error: "missing username" };
  }

  const { claudeApiKey = "" } = (await browser.storage.local.get(
    "claudeApiKey"
  )) as { claudeApiKey?: string };

  if (!claudeApiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const startedAt = Date.now();
  await setInvestigationState(username, {
    status: "running",
    startedAt,
    error: null,
  });

  const latestReports = await bonReadReports();
  const existingRecord =
    latestReports[bonFindReportKey(latestReports, username) ?? username] ??
    bonNormalizeReport(undefined);

  try {
    const inputs = await bonGatherProfile(username, {
      ...(existingRecord.botBouncerStatus
        ? { botBouncerStatus: existingRecord.botBouncerStatus }
        : {}),
      ...(existingRecord.botBouncerCheckedAt
        ? { botBouncerCheckedAt: existingRecord.botBouncerCheckedAt }
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
      await handleUpdateBotBouncerStatus({
        type: "update-botbouncer-status",
        username,
        status: inputs.botBouncerStatus,
      });
    }

    return {
      ok: true,
      result: { ...analysis, ...sharedFields, durationMs },
    };
  } catch (error) {
    console.error("[Bot or Not] investigation failed", error);

    await setInvestigationState(username, {
      status: "error",
      startedAt: null,
      error: String((error as { message?: string })?.message ?? error),
      durationMs: Date.now() - startedAt,
      ...(error instanceof RedditFetchError
        ? { redditMetrics: error.metrics }
        : {}),
    });

    return {
      ok: false,
      error: String((error as { message?: string })?.message ?? error),
    };
  }
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

async function handleFetchActivity(
  message: BaseMessage
): Promise<{ ok: boolean; activityData?: ActivityData; error?: string }> {
  const username = message.username as string;
  if (!username) {
    return { ok: false, error: "missing username" };
  }

  try {
    const activityData = await bonFetchUserActivity(username);
    await saveActivityData(username, activityData);
    return { ok: true, activityData };
  } catch (error) {
    console.error("[Bot or Not] fetch-activity failed", error);
    return {
      ok: false,
      error: String((error as { message?: string })?.message ?? error),
    };
  }
}

async function handleGetUserState(
  message: BaseMessage
): Promise<{ count: number; isBot: boolean }> {
  const reports = await bonReadReports();
  const username = message.username as string;
  const count = reports[username]?.count ?? 0;
  return { count, isBot: count > 0 };
}

async function handleGetUserReport(
  message: BaseMessage
): Promise<{ report: Report | null; expectedDurationMs: number | null }> {
  const reports = await bonReadReports();
  const expectedDurationMs = bonExpectedDurationMs(Object.values(reports));
  const key = bonFindReportKey(reports, message.username as string);

  if (!key) {
    return { report: null, expectedDurationMs };
  }

  return { report: reports[key]!, expectedDurationMs };
}

async function handleLinkRing(
  message: BaseMessage
): Promise<{ ok: boolean; ringId?: string; error?: string }> {
  const usernames = Array.isArray(message.usernames)
    ? (message.usernames as string[]).filter(
        (name) => typeof name === "string" && name.length > 0
      )
    : [];

  if (usernames.length < 2) {
    return { ok: false, error: "need-at-least-two" };
  }

  const reports = await bonReadReports();
  const keys: string[] = [];

  for (const username of usernames) {
    const key = bonFindReportKey(reports, username);
    if (!key) {
      return { ok: false, error: `unknown-user:${username}` };
    }

    keys.push(key);
  }

  const existingRingIds = new Set<string>();

  for (const key of keys) {
    const ringId = reports[key].ringId;
    if (ringId) {
      existingRingIds.add(ringId);
    }
  }

  if (existingRingIds.size > 1) {
    return { ok: false, error: "multiple-existing-rings" };
  }

  const ringId =
    existingRingIds.size === 1
      ? [...existingRingIds][0]
      : bonGenerateRingId(collectExistingRingIds(reports));

  for (const key of keys) {
    if (reports[key].ringId === ringId) {
      continue;
    }

    reports[key] = { ...reports[key], ringId };
  }

  await bonWriteReports(reports);
  return { ok: true, ringId };
}

async function handleUnlinkRing(
  message: BaseMessage
): Promise<{ ok: boolean; error?: string }> {
  const usernames = Array.isArray(message.usernames)
    ? (message.usernames as string[]).filter(
        (name) => typeof name === "string" && name.length > 0
      )
    : [];

  if (usernames.length === 0) {
    return { ok: false, error: "no-usernames" };
  }

  const reports = await bonReadReports();
  let changed = false;

  for (const username of usernames) {
    const key = bonFindReportKey(reports, username);
    if (!key) {
      continue;
    }

    if (reports[key].ringId === null) {
      continue;
    }

    reports[key] = { ...reports[key], ringId: null };
    changed = true;
  }

  if (changed) {
    await bonWriteReports(reports);
  }

  return { ok: true };
}

function collectExistingRingIds(reports: Record<string, Report>): Set<string> {
  const out = new Set<string>();

  for (const report of Object.values(reports)) {
    if (report.ringId) {
      out.add(report.ringId);
    }
  }

  return out;
}

// Bridge the agent's named tool calls to the same handler functions that
// `browser.runtime.onMessage` already routes through. Each branch reshapes
// the tool input into the BaseMessage shape that handler expects.
async function handleAiCommand(
  message: BaseMessage
): Promise<AiCommandResult | { ok: false; error: string }> {
  const input = ((message.input as string) ?? "").trim();
  if (!input) {
    return { ok: false, error: "empty-input" };
  }

  const { claudeApiKey = "" } = (await browser.storage.local.get(
    "claudeApiKey"
  )) as { claudeApiKey?: string };

  if (!claudeApiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const reports = await bonReadReports();

  // Compute a country code per user so the agent can answer "filter to US
  // accounts" without us shipping all the underlying signals. Soft inferences
  // (timezone-only band) collapse to null — too noisy as a filter target.
  const regions: Record<string, string | null> = {};

  for (const [username, report] of Object.entries(reports)) {
    const result = bonReportsComputeRegionForReport({ username, ...report });
    regions[username] =
      result?.kind === "ai" || result?.kind === "deterministic"
        ? result.region
        : null;
  }

  const snapshot = bonAiCommandBuildSnapshot(reports, regions);

  const result = await bonRunAiCommand(
    claudeApiKey,
    snapshot,
    input,
    async (tool, args) => {
      if (tool === "link_ring") {
        return handleLinkRing({
          type: "link-ring",
          usernames: args.usernames,
        });
      }

      if (tool === "unlink_ring") {
        return handleUnlinkRing({
          type: "unlink-ring",
          usernames: args.usernames,
        });
      }

      if (tool === "delete_report") {
        return handleDeleteReport({
          type: "delete-report",
          username: args.username,
        });
      }

      if (tool === "investigate_user") {
        // Don't block the agent loop on a full ~60s investigation — fire it
        // off and report back immediately. The reports page polls and the row
        // flips to "running" on its own.
        void handleInvestigateUser({
          type: "investigate-user",
          username: args.username,
        });

        return { ok: true, started: true };
      }

      if (tool === "set_user_status") {
        await handleUpdateUserStatus({
          type: "update-user-status",
          username: args.username,
          status: args.status,
        });

        return { ok: true };
      }

      if (tool === "filter_users") {
        // UI-only action — the input list flows through to the reports page
        // via the agent's actions[] and gets applied as a visible-row gate.
        const usernames = Array.isArray(args.usernames)
          ? (args.usernames as string[])
          : [];

        return { ok: true, count: usernames.length };
      }

      if (tool === "navigate_to_user") {
        // Storage-side no-op — resolve the username to the canonical stored key
        // and hand it back so the reports page can select that row after the
        // agent returns. Tries exact (case-insensitive) match first, then falls
        // back to a substring match so a partial reference like "spam" still
        // lands somewhere reasonable if Claude passed the operator's phrasing
        // through without resolving it against the snapshot.
        const requested = ((args.username as string) ?? "").trim();
        const latest = await bonReadReports();

        let key = bonFindReportKey(latest, requested);

        if (!key && requested) {
          const needle = requested.toLowerCase();
          const candidates = Object.keys(latest).filter((name) =>
            name.toLowerCase().includes(needle)
          );

          // Shortest match wins — "alice" in {"alice42", "alice_test_account"}
          // prefers "alice42" as the tighter fit.
          candidates.sort((a, b) => a.length - b.length);
          key = candidates[0] ?? null;
        }

        if (!key) {
          return { ok: false, error: `unknown user: ${requested}` };
        }

        return { ok: true, username: key };
      }

      return { ok: false, error: `unknown tool: ${tool}` };
    },
    aiCommandHistory
  );

  // Persist the updated transcript so the next `ai-command` call sees this
  // turn as prior context. The result also carries `history` for callers
  // that want to mirror it (none today).
  aiCommandHistory = result.history;
  return result;
}
