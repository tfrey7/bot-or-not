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
      if (inv?.status !== "running") continue;
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
  if (message.type === "open-tabs") {
    return handleOpenTabs(message);
  }
  if (message.type === "report-user") {
    return handleReportUser(message);
  }
  if (message.type === "get-user-state") {
    return handleGetUserState(message);
  }
  if (message.type === "get-user-report") {
    return handleGetUserReport(message);
  }
  if (message.type === "get-known-bots") {
    return handleGetKnownBots();
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

async function handleOpenPopup() {
  try {
    await browser.action.openPopup();
  } catch (err) {
    console.error("[Bot or Not] openPopup failed", err);
  }
}

function handleOpenTabs(message) {
  message.urls.forEach((url) => {
    browser.tabs.create({ url });
  });
}

function mergeHistoryEntries(a, b) {
  const newer = (b?.at || 0) >= (a?.at || 0) ? b : a;
  const older = newer === a ? b : a;
  return {
    ...older,
    ...newer,
    status: newer.status || older.status,
    statusCheckedAt: newer.statusCheckedAt || older.statusCheckedAt,
  };
}

function dedupeHistory(history) {
  const seen = new Map();
  const out = [];
  for (const entry of history) {
    const key = entry?.permalink;
    if (key && seen.has(key)) {
      const idx = seen.get(key);
      out[idx] = mergeHistoryEntries(out[idx], entry);
    } else {
      if (key) seen.set(key, out.length);
      out.push({ ...entry });
    }
  }
  return out;
}

function normalizeReport(value) {
  if (typeof value === "number") {
    return {
      count: value,
      lastReportedAt: 0,
      history: [],
      userStatus: null,
      userStatusCheckedAt: 0,
      createdAt: null,
    };
  }
  const history = dedupeHistory(
    Array.isArray(value?.history) ? value.history : []
  );
  const count = history.length > 0 ? history.length : (value?.count ?? 0);
  return {
    count,
    lastReportedAt: value?.lastReportedAt ?? 0,
    history,
    userStatus: value?.userStatus ?? null,
    userStatusCheckedAt: value?.userStatusCheckedAt ?? 0,
    createdAt: value?.createdAt ?? null,
    botBouncerStatus: value?.botBouncerStatus ?? null,
    botBouncerCheckedAt: value?.botBouncerCheckedAt ?? 0,
    investigation: value?.investigation ?? null,
    activityData: value?.activityData ?? null,
  };
}

function findReportKey(reports, username) {
  if (reports[username]) return username;
  const target = username.toLowerCase();
  for (const k of Object.keys(reports)) {
    if (k.toLowerCase() === target) return k;
  }
  return null;
}

async function handleReportUser(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const existing = normalizeReport(reports[message.username]);
  const at = Date.now();
  const entry = { at, ...(message.context || {}) };
  const history = dedupeHistory([...existing.history, entry]);
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
    if (!claudeApiKey) return;
    const { reports = {} } = await browser.storage.local.get("reports");
    const key = findReportKey(reports, username) || username;
    const inv = normalizeReport(reports[key]).investigation;
    if (inv?.status === "running" && !bonIsInvestigationStale(inv)) return;
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

async function handleUpdateUserCreatedAt(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  if (!reports[message.username]) return;
  const existing = normalizeReport(reports[message.username]);
  if (existing.createdAt) return;
  reports[message.username] = {
    ...existing,
    createdAt: message.createdAt,
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdateUserStatus(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  // Only update users we've already reported
  if (!reports[message.username]) return;
  const existing = normalizeReport(reports[message.username]);
  if (existing.userStatus === message.status) return;
  reports[message.username] = {
    ...existing,
    userStatus: message.status,
    userStatusCheckedAt: Date.now(),
  };
  await browser.storage.local.set({ reports });
}

async function handleUpdateBotBouncerStatus(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const key = findReportKey(reports, message.username);
  if (!key) return;
  const existing = normalizeReport(reports[key]);
  if (existing.botBouncerStatus === message.status) return;
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
    const existing = normalizeReport(reports[username]);
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

async function handleGetKnownBots() {
  const { reports = {} } = await browser.storage.local.get("reports");
  // Only users who've actually been reported get the inline bot icon —
  // investigated-only records (count: 0) are tracked but not flagged sitewide.
  const bots = [];
  for (const [username, value] of Object.entries(reports)) {
    if (normalizeReport(value).count > 0) bots.push(username);
  }
  return { bots };
}

async function handleGetAllReports() {
  const { reports = {} } = await browser.storage.local.get("reports");
  const normalized = {};
  for (const [username, value] of Object.entries(reports)) {
    normalized[username] = normalizeReport(value);
  }
  return { reports: normalized };
}

async function handleClearAllReports() {
  await browser.storage.local.set({ reports: {} });
  return { ok: true };
}

async function handleDeleteReport(message) {
  const username = (message.username || "").trim();
  if (!username) return { ok: false, error: "missing-username" };
  const { reports = {} } = await browser.storage.local.get("reports");
  if (!(username in reports)) return { ok: true, removed: false };
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
  const key = findReportKey(reports, username) || username;
  const existing = normalizeReport(reports[key]);
  reports[key] = {
    ...existing,
    investigation: { ...(existing.investigation || {}), ...patch },
  };
  await browser.storage.local.set({ reports });
}

async function handleInvestigateUser(message) {
  const { username } = message;
  if (!username) return { ok: false, error: "missing username" };

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
  const existingRecord = normalizeReport(
    latestReports[findReportKey(latestReports, username) || username]
  );

  try {
    const result = await bonInvestigateUser(username, claudeApiKey, {
      botBouncerStatus: existingRecord.botBouncerStatus,
      botBouncerCheckedAt: existingRecord.botBouncerCheckedAt,
    });
    const durationMs = Date.now() - startedAt;
    const {
      activityData,
      botBouncerStatus,
      botBouncerCheckedAt,
      ...investigationFields
    } = result;
    await setInvestigationState(username, {
      status: "done",
      startedAt: null,
      error: null,
      durationMs,
      ...investigationFields,
    });
    if (activityData) {
      await saveActivityData(username, activityData);
    }
    if (botBouncerStatus) {
      await handleUpdateBotBouncerStatus({
        username,
        status: botBouncerStatus,
      });
    }
    return { ok: true, result: { ...result, durationMs } };
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
  const key = findReportKey(reports, username) || username;
  const existing = normalizeReport(reports[key]);
  reports[key] = { ...existing, activityData };
  await browser.storage.local.set({ reports });
}

async function handleFetchActivity(message) {
  const { username } = message;
  if (!username) return { ok: false, error: "missing username" };
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
  const { count } = normalizeReport(reports[message.username]);
  return { count, isBot: count > 0 };
}

async function handleGetUserReport(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const key = findReportKey(reports, message.username);
  if (!key) return { report: null };
  return { report: normalizeReport(reports[key]) };
}
