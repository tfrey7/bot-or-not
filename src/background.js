import {
  bonFetchUserActivity,
  bonGatherProfile,
  bonRunOneDAnalysis,
} from "./bot_analysis.js";
import {
  bonDedupeHistory,
  bonFindReportKey,
  bonNormalizeReport,
  bonSnapshotRun,
} from "./utils/history.js";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "./verdict.js";

console.log("[Bot or Not] background loaded");

// Any investigation found with status: "running" at startup was orphaned —
// a previous background-script instance died mid-await (web-ext reload, browser
// restart, service worker eviction) and its completion handler never fired.
// Convert these to a clean error state so the UI shows them as failed rather
// than stuck on a spinner forever.
void sweepOrphanedInvestigations();

async function sweepOrphanedInvestigations() {
  try {
    const { reports = {} } = await browser.storage.local.get("reports");
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

browser.runtime.onMessage.addListener((message) => {
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

async function openReportsTab() {
  const url = browser.runtime.getURL("src/reports.html");
  try {
    const existing = await browser.tabs.query({ url });
    if (existing && existing.length > 0) {
      const tab = existing[0];
      await browser.tabs.update(tab.id, { active: true });
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

async function handleOpenPopup() {
  await openReportsTab();
}

async function handleReportUser(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const existing = bonNormalizeReport(reports[message.username]);
  const at = Date.now();
  const entry = { at, ...(message.context || {}) };
  const history = bonDedupeHistory([...existing.history, entry]);
  reports[message.username] = {
    ...existing,
    count: history.length,
    lastReportedAt: at,
    history,
  };
  await browser.storage.local.set({ reports });
  void maybeAutoInvestigate(message.username);
  return { count: history.length };
}

const BON_AUTO_INVESTIGATE_FRESHNESS_MS = 60 * 60 * 1000;

async function maybeAutoInvestigate(username) {
  try {
    const { claudeApiKey = "" } =
      await browser.storage.local.get("claudeApiKey");
    if (!claudeApiKey) {
      return;
    }
    const { reports = {} } = await browser.storage.local.get("reports");
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
    await handleInvestigateUser({ username });
  } catch (err) {
    console.error("[Bot or Not] auto-investigate failed", err);
  }
}

// Viewing someone's profile is itself a signal of suspicion — kick off an
// investigation when one isn't already on file. Stale "running" is treated as
// no-investigation since a previous worker died mid-await. Done/error/fresh-
// running are left alone; the user can retry errors via the panel button.
async function handleAutoInvestigateOnView(message) {
  const username = (message.username || "").trim();
  if (!username) {
    return { ok: false, error: "missing-username" };
  }
  try {
    const { claudeApiKey = "" } =
      await browser.storage.local.get("claudeApiKey");
    if (!claudeApiKey) {
      return { ok: true, started: false };
    }
    const { reports = {} } = await browser.storage.local.get("reports");
    const key = bonFindReportKey(reports, username) || username;
    const inv = bonNormalizeReport(reports[key]).investigation;
    if (inv && !(inv.status === "running" && bonIsInvestigationStale(inv))) {
      return { ok: true, started: false };
    }
    void handleInvestigateUser({ username });
    return { ok: true, started: true };
  } catch (err) {
    console.error("[Bot or Not] auto-investigate-on-view failed", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

async function handleUpdateUserCreatedAt(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  if (!reports[message.username]) {
    return;
  }
  const existing = bonNormalizeReport(reports[message.username]);
  if (existing.createdAt) {
    return;
  }
  reports[message.username] = {
    ...existing,
    createdAt: message.createdAt,
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdateUserStatus(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  // Only update users we've already reported
  if (!reports[message.username]) {
    return;
  }
  const existing = bonNormalizeReport(reports[message.username]);
  if (existing.userStatus === message.status) {
    return;
  }
  reports[message.username] = {
    ...existing,
    userStatus: message.status,
    userStatusCheckedAt: Date.now(),
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdateBotBouncerStatus(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const key = bonFindReportKey(reports, message.username);
  if (!key) {
    return;
  }
  const existing = bonNormalizeReport(reports[key]);
  if (existing.botBouncerStatus === message.status) {
    return;
  }
  reports[key] = {
    ...existing,
    botBouncerStatus: message.status,
    botBouncerCheckedAt: Date.now(),
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdatePostStatus(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
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
          status: message.status,
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

async function handleGetUserTags() {
  const { reports = {} } = await browser.storage.local.get("reports");
  const tags = {};
  for (const [username, value] of Object.entries(reports)) {
    const tag = summarizeUserTag(username, value);
    if (tag) {
      tags[username] = tag;
    }
  }
  return { tags };
}

function summarizeUserTag(username, value) {
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

async function handleGetAllReports() {
  const { reports = {} } = await browser.storage.local.get("reports");
  const normalized = {};
  for (const [username, value] of Object.entries(reports)) {
    normalized[username] = bonNormalizeReport(value);
  }
  return { reports: normalized };
}

async function handleClearAllReports() {
  await browser.storage.local.set({ reports: {} });
  return { ok: true };
}

async function handleDeleteReport(message) {
  const username = (message.username || "").trim();
  if (!username) {
    return { ok: false, error: "missing-username" };
  }
  const { reports = {} } = await browser.storage.local.get("reports");
  if (!(username in reports)) {
    return { ok: true, removed: false };
  }
  delete reports[username];
  await browser.storage.local.set({ reports });
  return { ok: true, removed: true };
}

async function handleGetClaudeApiKey() {
  const { claudeApiKey = "" } = await browser.storage.local.get("claudeApiKey");
  return { hasKey: !!claudeApiKey };
}

async function handleSetClaudeApiKey(message) {
  const key = (message.apiKey || "").trim();
  if (!key) {
    await browser.storage.local.remove("claudeApiKey");
    return { ok: true, hasKey: false };
  }
  await browser.storage.local.set({ claudeApiKey: key });
  return { ok: true, hasKey: true };
}

async function setInvestigationState(username, patch) {
  const { reports = {} } = await browser.storage.local.get("reports");
  // Create the record on first investigation so users who haven't been
  // reported yet still get tracked.
  const key = bonFindReportKey(reports, username) || username;
  const existing = bonNormalizeReport(reports[key]);
  const prevInv = existing.investigation || {};
  const nextInv = { ...prevInv, ...patch };

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
        ? [bonSnapshotRun(prevInv, "done")]
        : prevRuns;
    nextInv.runs = [...seeded, bonSnapshotRun(nextInv, patch.status)];
  }

  reports[key] = { ...existing, investigation: nextInv };
  await browser.storage.local.set({ reports });
}

async function handleInvestigateUser(message) {
  const { username } = message;
  if (!username) {
    return { ok: false, error: "missing username" };
  }

  const { claudeApiKey = "" } = await browser.storage.local.get("claudeApiKey");
  if (!claudeApiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const startedAt = Date.now();
  await setInvestigationState(username, {
    status: "running",
    startedAt,
    error: null,
  });

  const { reports: latestReports = {} } =
    await browser.storage.local.get("reports");
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
      error: String(err?.message || err),
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

async function saveActivityData(username, activityData) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const key = bonFindReportKey(reports, username) || username;
  const existing = bonNormalizeReport(reports[key]);
  reports[key] = { ...existing, activityData };
  await browser.storage.local.set({ reports });
}

async function handleFetchActivity(message) {
  const { username } = message;
  if (!username) {
    return { ok: false, error: "missing username" };
  }
  try {
    const activityData = await bonFetchUserActivity(username);
    await saveActivityData(username, activityData);
    return { ok: true, activityData };
  } catch (err) {
    console.error("[Bot or Not] fetch-activity failed", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

async function handleGetUserState(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const { count } = bonNormalizeReport(reports[message.username]);
  return { count, isBot: count > 0 };
}

async function handleGetUserReport(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const key = bonFindReportKey(reports, message.username);
  if (!key) {
    return { report: null };
  }
  return { report: bonNormalizeReport(reports[key]) };
}
