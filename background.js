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
});

function handleOpenTabs(message) {
  message.urls.forEach((url) => {
    browser.tabs.create({ url });
  });
}

async function handleReportUser(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  reports[message.username] = (reports[message.username] || 0) + 1;
  await browser.storage.local.set({ reports });
  return { count: reports[message.username] };
}

async function handleGetKnownBots() {
  const { reports = {} } = await browser.storage.local.get("reports");
  return { bots: Object.keys(reports) };
}

async function handleGetAllReports() {
  const { reports = {} } = await browser.storage.local.get("reports");
  return { reports };
}

async function handleGetUserState(message) {
  const { reports = {} } = await browser.storage.local.get("reports");
  const count = reports[message.username] || 0;
  return { count, isBot: count > 0 };
}
