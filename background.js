console.log("[Bot or Not] background loaded");

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
  if (message.type === "get-known-bots") {
    return handleGetKnownBots();
  }
  if (message.type === "get-all-reports") {
    return handleGetAllReports();
  }
  if (message.type === "update-user-status") {
    return handleUpdateUserStatus(message);
  }
  if (message.type === "update-post-status") {
    return handleUpdatePostStatus(message);
  }
  if (message.type === "clear-all-reports") {
    return handleClearAllReports();
  }
});

function handleOpenTabs(message) {
  message.urls.forEach((url) => {
    browser.tabs.create({ url });
  });
}

function normalizeReport(value) {
  if (typeof value === "number") {
    return {
      count: value,
      lastReportedAt: 0,
      history: [],
      userStatus: null,
      userStatusCheckedAt: 0,
    };
  }
  return {
    count: value?.count ?? 0,
    lastReportedAt: value?.lastReportedAt ?? 0,
    history: Array.isArray(value?.history) ? value.history : [],
    userStatus: value?.userStatus ?? null,
    userStatusCheckedAt: value?.userStatusCheckedAt ?? 0,
  };
}

async function handleReportUser(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const existing = normalizeReport(reports[message.username]);
  const at = Date.now();
  const entry = { at, ...(message.context || {}) };
  reports[message.username] = {
    ...existing,
    count: existing.count + 1,
    lastReportedAt: at,
    history: [...existing.history, entry],
  };
  await browser.storage.local.set({ reports });
  return { count: reports[message.username].count };
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
  return { bots: Object.keys(reports) };
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

async function handleGetUserState(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const { count } = normalizeReport(reports[message.username]);
  return { count, isBot: count > 0 };
}
