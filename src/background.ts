import {
  bonFetchUserActivity,
  bonGatherProfile,
  bonRunOneDAnalysis,
} from "./features/investigation/index.ts";
import type { ActivityData, Investigation, Report } from "./types.ts";
import {
  bonDedupeHistory,
  bonFindReportKey,
  bonNormalizeReport,
  bonSnapshotRun,
} from "./utils/history.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "./verdict.ts";

console.log("[Bot or Not] background loaded");

// Any investigation found with status: "running" at startup was orphaned —
// a previous background-script instance died mid-await (web-ext reload, browser
// restart, service worker eviction) and its completion handler never fired.
// Convert these to a clean error state so the UI shows them as failed rather
// than stuck on a spinner forever.
void sweepOrphanedInvestigations();

async function sweepOrphanedInvestigations(): Promise<void> {
  try {
    const { reports = {} } = (await browser.storage.local.get("reports")) as {
      reports?: Record<string, Report>;
    };

    let changed = false;
    for (const [username, value] of Object.entries(reports)) {
      const inv = value?.investigation;
      if (inv?.status !== "running") {
        continue;
      }

      const startedAt = inv.startedAt || 0;
      reports[username] = {
        ...value,
        investigation: {
          ...inv,
          status: "error",
          startedAt: null,
          error: "interrupted before completion",
          durationMs: startedAt ? Date.now() - startedAt : null,
        },
      };
      changed = true;
    }

    if (changed) {
      await browser.storage.local.set({ reports });
      console.log("[Bot or Not] swept orphaned investigations");
    }
  } catch (err) {
    console.error("[Bot or Not] orphan sweep failed", err);
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
  if (message.type === "update-user-created-at") {
    return handleUpdateUserCreatedAt(message);
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
});

browser.action.onClicked.addListener(() => {
  void openReportsTab();
});

async function openReportsTab(): Promise<void> {
  const url = browser.runtime.getURL("src/reports.html");
  try {
    const existing = await browser.tabs.query({ url });
    if (existing && existing.length > 0) {
      const tab = existing[0];
      if (tab.id != null) {
        await browser.tabs.update(tab.id, { active: true });
      }
      if (tab.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
      return;
    }

    await browser.tabs.create({ url });
  } catch (err) {
    console.error("[Bot or Not] openReportsTab failed", err);
  }
}

async function handleOpenPopup(): Promise<void> {
  await openReportsTab();
}

async function handleReportUser(
  message: BaseMessage
): Promise<{ count: number }> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };

  const username = message.username as string;
  const existing = bonNormalizeReport(reports[username]);
  const at = Date.now();
  const entry = { at, ...((message.context as Record<string, unknown>) || {}) };
  const history = bonDedupeHistory([...existing.history, entry]);

  reports[username] = {
    ...existing,
    count: history.length,
    lastReportedAt: at,
    history,
  };
  await browser.storage.local.set({ reports });

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

    const { reports = {} } = (await browser.storage.local.get("reports")) as {
      reports?: Record<string, Report>;
    };
    const key = bonFindReportKey(reports, username) || username;
    const inv = bonNormalizeReport(reports[key]).investigation;

    if (inv?.status === "running" && !bonIsInvestigationStale(inv)) {
      return;
    }

    if (
      inv?.runAt &&
      Date.now() - inv.runAt < BON_AUTO_INVESTIGATE_FRESHNESS_MS
    ) {
      return;
    }

    await handleInvestigateUser({ type: "investigate-user", username });
  } catch (err) {
    console.error("[Bot or Not] auto-investigate failed", err);
  }
}

// Viewing someone's profile is itself a signal of suspicion — kick off an
// investigation when one isn't already on file. Stale "running" is treated as
// no-investigation since a previous worker died mid-await. Done/error/fresh-
// running are left alone; the user can retry errors via the panel button.
async function handleAutoInvestigateOnView(
  message: BaseMessage
): Promise<{ ok: boolean; started?: boolean; error?: string }> {
  const username = ((message.username as string) || "").trim();
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

    const { reports = {} } = (await browser.storage.local.get("reports")) as {
      reports?: Record<string, Report>;
    };
    const key = bonFindReportKey(reports, username) || username;
    const inv = bonNormalizeReport(reports[key]).investigation;

    if (inv && !(inv.status === "running" && bonIsInvestigationStale(inv))) {
      return { ok: true, started: false };
    }

    void handleInvestigateUser({ type: "investigate-user", username });
    return { ok: true, started: true };
  } catch (err) {
    console.error("[Bot or Not] auto-investigate-on-view failed", err);
    return {
      ok: false,
      error: String((err as { message?: string })?.message || err),
    };
  }
}

async function handleUpdateUserCreatedAt(message: BaseMessage): Promise<void> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  const username = message.username as string;

  if (!reports[username]) {
    return;
  }

  const existing = bonNormalizeReport(reports[username]);
  if (existing.createdAt) {
    return;
  }

  reports[username] = {
    ...existing,
    createdAt: message.createdAt as number,
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdateUserStatus(message: BaseMessage): Promise<void> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  const username = message.username as string;

  // Only update users we've already reported
  if (!reports[username]) {
    return;
  }

  const existing = bonNormalizeReport(reports[username]);
  if (existing.userStatus === message.status) {
    return;
  }

  reports[username] = {
    ...existing,
    userStatus: message.status as Report["userStatus"],
    userStatusCheckedAt: Date.now(),
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdateBotBouncerStatus(
  message: BaseMessage
): Promise<void> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  const key = bonFindReportKey(reports, message.username as string);

  if (!key) {
    return;
  }

  const existing = bonNormalizeReport(reports[key]);
  if (existing.botBouncerStatus === message.status) {
    return;
  }

  reports[key] = {
    ...existing,
    botBouncerStatus: message.status as Report["botBouncerStatus"],
    botBouncerCheckedAt: Date.now(),
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdatePostStatus(message: BaseMessage): Promise<void> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };

  let updated = false;
  for (const username of Object.keys(reports)) {
    const existing = bonNormalizeReport(reports[username]);
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
    await browser.storage.local.set({ reports });
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
}

async function handleGetUserTags(): Promise<{ tags: Record<string, UserTag> }> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };

  const tags: Record<string, UserTag> = {};
  for (const [username, value] of Object.entries(reports)) {
    const tag = summarizeUserTag(username, value);
    if (tag) {
      tags[username] = tag;
    }
  }
  return { tags };
}

function summarizeUserTag(username: string, value: unknown): UserTag | null {
  const r = bonNormalizeReport(value);
  const inv = bonNormalizeInvestigation(r.investigation);
  const verdict = inv?.status === "done" && inv?.verdict ? inv.verdict : null;
  const investigationStatus = inv?.status || null;

  const hasSignal =
    verdict ||
    r.count > 0 ||
    r.userStatus ||
    r.botBouncerStatus ||
    investigationStatus === "running";

  if (!hasSignal) {
    return null;
  }

  return {
    username,
    count: r.count,
    verdict,
    confidence: typeof inv?.confidence === "number" ? inv.confidence : null,
    investigationStatus,
    investigationStartedAt: inv?.startedAt || null,
    botBouncerStatus: r.botBouncerStatus || null,
    userStatus: r.userStatus || null,
  };
}

async function handleGetAllReports(): Promise<{
  reports: Record<string, Report>;
}> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };

  const normalized: Record<string, Report> = {};
  for (const [username, value] of Object.entries(reports)) {
    normalized[username] = bonNormalizeReport(value);
  }
  return { reports: normalized };
}

async function handleClearAllReports(): Promise<{ ok: boolean }> {
  await browser.storage.local.set({ reports: {} });
  return { ok: true };
}

async function handleDeleteReport(
  message: BaseMessage
): Promise<{ ok: boolean; removed?: boolean; error?: string }> {
  const username = ((message.username as string) || "").trim();
  if (!username) {
    return { ok: false, error: "missing-username" };
  }

  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  if (!(username in reports)) {
    return { ok: true, removed: false };
  }

  delete reports[username];
  await browser.storage.local.set({ reports });
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
  patch: Partial<Investigation>
): Promise<void> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };

  // Create the record on first investigation so users who haven't been
  // reported yet still get tracked.
  const key = bonFindReportKey(reports, username) || username;
  const existing = bonNormalizeReport(reports[key]);
  const prevInv: Partial<Investigation> = existing.investigation || {};
  const nextInv = { ...prevInv, ...patch } as Investigation;

  // Append a snapshot to runs[] whenever a run terminates. Older records have
  // only the single most-recent investigation stored — seed runs[] from those
  // fields on the first re-run so historical timing/cost data survives.
  const completing =
    prevInv.status === "running" &&
    (patch.status === "done" || patch.status === "error");

  if (completing) {
    const prevRuns = Array.isArray(prevInv.runs) ? prevInv.runs : [];
    const seeded =
      prevRuns.length === 0 &&
      prevInv.runAt &&
      typeof prevInv.durationMs === "number"
        ? [bonSnapshotRun(prevInv as Investigation, "done")]
        : prevRuns;

    nextInv.runs = [
      ...seeded,
      bonSnapshotRun(nextInv, patch.status as "done" | "error"),
    ];
  }

  reports[key] = { ...existing, investigation: nextInv };
  await browser.storage.local.set({ reports });
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

  const { reports: latestReports = {} } = (await browser.storage.local.get(
    "reports"
  )) as { reports?: Record<string, Report> };
  const existingRecord = bonNormalizeReport(
    latestReports[bonFindReportKey(latestReports, username) || username]
  );

  try {
    const inputs = await bonGatherProfile(username, {
      botBouncerStatus: existingRecord.botBouncerStatus,
      botBouncerCheckedAt: existingRecord.botBouncerCheckedAt,
    });
    const oneD = await bonRunOneDAnalysis(claudeApiKey, inputs.summary);

    const durationMs = Date.now() - startedAt;
    console.log(
      `[Bot or Not] timing: investigation ${username} ${durationMs}ms`
    );

    const sharedFields = {
      postsFetched: inputs.raw.submitted?.data?.children?.length || 0,
      commentsFetched: inputs.raw.comments?.data?.children?.length || 0,
      accountCreatedAt: inputs.summary.account.created_at,
      accountAgeDays: inputs.summary.account.age_days,
    };

    await setInvestigationState(username, {
      status: "done",
      startedAt: null,
      error: null,
      durationMs,
      ...oneD,
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
      result: { ...oneD, ...sharedFields, durationMs },
    };
  } catch (err) {
    console.error("[Bot or Not] investigation failed", err);

    await setInvestigationState(username, {
      status: "error",
      startedAt: null,
      error: String((err as { message?: string })?.message || err),
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: false,
      error: String((err as { message?: string })?.message || err),
    };
  }
}

async function saveActivityData(
  username: string,
  activityData: ActivityData
): Promise<void> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  const key = bonFindReportKey(reports, username) || username;
  const existing = bonNormalizeReport(reports[key]);
  reports[key] = { ...existing, activityData };
  await browser.storage.local.set({ reports });
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
  } catch (err) {
    console.error("[Bot or Not] fetch-activity failed", err);
    return {
      ok: false,
      error: String((err as { message?: string })?.message || err),
    };
  }
}

async function handleGetUserState(
  message: BaseMessage
): Promise<{ count: number; isBot: boolean }> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  const { count } = bonNormalizeReport(reports[message.username as string]);
  return { count, isBot: count > 0 };
}

async function handleGetUserReport(
  message: BaseMessage
): Promise<{ report: Report | null }> {
  const { reports = {} } = (await browser.storage.local.get("reports")) as {
    reports?: Record<string, Report>;
  };
  const key = bonFindReportKey(reports, message.username as string);

  if (!key) {
    return { report: null };
  }

  return { report: bonNormalizeReport(reports[key]) };
}
