(async function () {
  const tbody = document.getElementById("bon-tbody");
  const tableWrap = document.getElementById("bon-table-wrap");
  const emptyEl = document.getElementById("bon-empty");
  const searchInput = document.getElementById("bon-search");
  const clearBtn = document.getElementById("bon-clear-btn");
  const modal = document.getElementById("bon-confirm-modal");
  const modalText = document.getElementById("bon-modal-text");
  const cancelBtn = document.getElementById("bon-cancel-clear");
  const confirmBtn = document.getElementById("bon-confirm-clear");
  const settingsBtn = document.getElementById("bon-settings-btn");
  const settingsModal = document.getElementById("bon-settings-modal");
  const settingsCancel = document.getElementById("bon-settings-cancel");
  const settingsSave = document.getElementById("bon-settings-save");
  const apiKeyInput = document.getElementById("bon-api-key-input");
  const apiKeyStatus = document.getElementById("bon-api-key-status");
  let pendingConfirmAction = null;

  let allReports = [];
  // Median across every prior completed run. Used to drive the progress ring
  // and "~Xs left" countdown on in-flight investigations. Recomputed before
  // render and before each poll tick. Null until we have ≥3 completed runs.
  let expectedDurationMs = null;
  const analyticsContainer = document.getElementById("bon-analytics-container");
  let sortKey = "investigatedAt";
  let sortDir = "desc";
  const expanded = new Set();
  const inflightActivity = new Set();
  const BON_ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

  function isActivityFresh(activityData) {
    return (
      !!activityData?.fetchedAt &&
      Date.now() - activityData.fetchedAt < BON_ACTIVITY_TTL_MS
    );
  }

  async function loadActivityIfStale(username, activityData) {
    if (isActivityFresh(activityData)) {
      return;
    }
    if (inflightActivity.has(username)) {
      return;
    }
    inflightActivity.add(username);
    try {
      await browser.runtime.sendMessage({ type: "fetch-activity", username });
    } catch (err) {
      console.error("[Bot or Not] auto-load activity failed", err);
    } finally {
      inflightActivity.delete(username);
    }
  }

  function renderActivityLoadingPlaceholder() {
    const wrap = document.createElement("div");
    wrap.className = "bon-detail-wrap";
    const title = document.createElement("p");
    title.className = "bon-detail-title";
    title.textContent = "Activity heatmap";
    wrap.appendChild(title);
    const loading = document.createElement("p");
    loading.className = "bon-heatmap-empty";
    loading.textContent = "Loading activity…";
    wrap.appendChild(loading);
    return wrap;
  }
  // While any investigation is "running", poll storage so the elapsed timer
  // ticks and completion/error transitions land without a manual refresh.
  // storage.onChanged should cover the transitions but doesn't always fire
  // reliably across extension pages, so the poll is the source of truth.
  let pollTimer = null;
  const POLL_INTERVAL_MS = 1000;

  // Factor list is canonical in src/factors.js. Stored investigations may
  // contain factor keys not in this list (deprecated since the report ran) —
  // those are dropped silently. Keys in this list missing from a stored
  // investigation are rendered as "added after" placeholders so old reports
  // stay readable without re-running.
  const FACTOR_LABELS = BON_FACTOR_LABELS;
  const FACTOR_KEYS = BON_FACTOR_KEYS;

  const VERDICT_RANK = {
    bot: 0,
    "likely-bot": 1,
    uncertain: 2,
    "likely-human": 3,
    human: 4,
  };

  const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.reports) {
      load();
    }
  });

  searchInput.addEventListener("input", render);

  function openConfirmModal({ text, confirmLabel, action }) {
    modalText.textContent = text;
    confirmBtn.textContent = confirmLabel;
    pendingConfirmAction = action;
    modal.hidden = false;
    cancelBtn.focus();
  }

  function closeConfirmModal() {
    modal.hidden = true;
    pendingConfirmAction = null;
  }

  clearBtn.addEventListener("click", () => {
    openConfirmModal({
      text: "Clear all reported users? This can't be undone.",
      confirmLabel: "Clear all",
      action: () => browser.runtime.sendMessage({ type: "clear-all-reports" }),
    });
  });
  cancelBtn.addEventListener("click", closeConfirmModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeConfirmModal();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") {
      return;
    }
    if (!modal.hidden) {
      closeConfirmModal();
    }
    if (!settingsModal.hidden) {
      settingsModal.hidden = true;
    }
  });

  settingsBtn.addEventListener("click", openSettings);
  settingsCancel.addEventListener("click", () => {
    settingsModal.hidden = true;
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal.hidden = true;
    }
  });
  settingsSave.addEventListener("click", saveApiKey);

  async function openSettings() {
    apiKeyInput.value = "";
    apiKeyStatus.textContent = "Loading...";
    apiKeyStatus.className = "bon-settings-status";
    settingsModal.hidden = false;
    apiKeyInput.focus();
    try {
      const { hasKey } = await browser.runtime.sendMessage({
        type: "get-claude-api-key",
      });
      renderApiKeyStatus(hasKey);
    } catch (err) {
      apiKeyStatus.textContent = "Failed to read key status.";
      apiKeyStatus.className =
        "bon-settings-status bon-settings-status--missing";
    }
  }

  function renderApiKeyStatus(hasKey) {
    if (hasKey) {
      apiKeyStatus.textContent =
        "Key set. Type a new one to replace, or leave blank to keep.";
      apiKeyStatus.className = "bon-settings-status bon-settings-status--set";
      apiKeyInput.placeholder = "•••• (key on file)";
    } else {
      apiKeyStatus.textContent =
        "No key set. Investigations will fail until one is saved.";
      apiKeyStatus.className =
        "bon-settings-status bon-settings-status--missing";
      apiKeyInput.placeholder = "sk-ant-...";
    }
  }

  async function saveApiKey() {
    const value = apiKeyInput.value.trim();
    if (!value) {
      settingsModal.hidden = true;
      return;
    }
    settingsSave.disabled = true;
    try {
      const { hasKey } = await browser.runtime.sendMessage({
        type: "set-claude-api-key",
        apiKey: value,
      });
      renderApiKeyStatus(hasKey);
      apiKeyInput.value = "";
      settingsModal.hidden = true;
    } catch (err) {
      apiKeyStatus.textContent = "Failed to save key.";
      apiKeyStatus.className =
        "bon-settings-status bon-settings-status--missing";
    } finally {
      settingsSave.disabled = false;
    }
  }
  confirmBtn.addEventListener("click", async () => {
    if (!pendingConfirmAction) {
      return;
    }
    const action = pendingConfirmAction;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await action();
      closeConfirmModal();
      await load();
    } catch (err) {
      console.error("[Bot or Not] confirm action failed", err);
    } finally {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  document.querySelectorAll("th.bon-sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = th.dataset.defaultDir || defaultDirFor(key);
      }
      render();
    });
  });

  await load();

  async function load() {
    try {
      const { reports = {} } = await browser.runtime.sendMessage({
        type: "get-all-reports",
      });
      allReports = Object.entries(reports).map(([username, data]) => ({
        username,
        ...data,
      }));
      render();
      renderAnalytics();
    } catch (err) {
      console.error("[Bot or Not] failed to load reports", err);
      tableWrap.hidden = true;
      emptyEl.hidden = false;
      renderLoadError(err);
    }
  }

  function renderLoadError(err) {
    emptyEl.replaceChildren();

    const heading = document.createElement("p");
    heading.className = "bon-empty-text";
    heading.textContent = "Failed to load reports.";
    emptyEl.appendChild(heading);

    const rawMessage = err?.message || String(err) || "Unknown error";
    const hint = diagnoseLoadError(rawMessage);

    const detail = document.createElement("p");
    detail.className = "bon-empty-text bon-empty-detail";
    detail.textContent = rawMessage;
    emptyEl.appendChild(detail);

    if (hint) {
      const hintEl = document.createElement("p");
      hintEl.className = "bon-empty-text bon-empty-hint";
      hintEl.textContent = hint;
      emptyEl.appendChild(hintEl);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-btn bon-empty-action";
    btn.textContent = "Reload page";
    btn.addEventListener("click", () => {
      location.reload();
    });
    emptyEl.appendChild(btn);
  }

  function diagnoseLoadError(message) {
    const msg = (message || "").toLowerCase();
    if (
      msg.includes("receiving end does not exist") ||
      msg.includes("could not establish connection") ||
      msg.includes("message port closed")
    ) {
      return "The extension background worker isn't responding. This usually happens after the extension was reloaded or updated while this page was open. Reload the page to reconnect.";
    }
    if (msg.includes("quota") || msg.includes("storage")) {
      return "Browser storage may be full or unavailable. Try clearing some reports or checking your browser's extension storage permissions.";
    }
    if (msg.includes("undefined") || msg.includes("cannot read")) {
      return "Stored report data may be corrupted. Check the browser console for details, or clear all reports from Settings as a last resort.";
    }
    return "Open the browser console (F12) for more details, then try reloading the page.";
  }

  // Analytics shows aggregates across every investigation, so it should not
  // react to the search input or to every poll tick — only when the underlying
  // data actually changes.
  function renderAnalytics() {
    if (!analyticsContainer) {
      return;
    }
    if (typeof bonRenderAnalytics !== "function") {
      return;
    }
    bonRenderAnalytics(allReports, analyticsContainer);
  }

  // Median duration across all completed runs (including runs[] history).
  // Returns null below 3 samples — not enough signal to predict against.
  function computeExpectedDurationMs() {
    const durs = [];
    for (const r of allReports) {
      const inv = r.investigation;
      if (!inv) {
        continue;
      }
      if (Array.isArray(inv.runs) && inv.runs.length > 0) {
        for (const run of inv.runs) {
          if (run.status === "done" && typeof run.durationMs === "number") {
            durs.push(run.durationMs);
          }
        }
      } else if (inv.status === "done" && typeof inv.durationMs === "number") {
        durs.push(inv.durationMs);
      }
    }
    if (durs.length < 3) {
      return null;
    }
    durs.sort((a, b) => a - b);
    return durs[Math.floor(durs.length / 2)];
  }

  function formatExpectedSec(ms) {
    return Math.max(1, Math.round(ms / 1000));
  }

  function formatRunningCellText(elapsedSec, expectedMs) {
    if (!expectedMs) {
      return `Running… ${elapsedSec}s`;
    }
    return `Running… ${elapsedSec}s / ~${formatExpectedSec(expectedMs)}s`;
  }

  function formatRunningTitle(elapsedSec, expectedMs) {
    if (!expectedMs) {
      return `Investigation running… ${elapsedSec}s elapsed (large accounts can take 60–90s)`;
    }
    const expSec = formatExpectedSec(expectedMs);
    if (elapsedSec > expSec) {
      return `Running ${elapsedSec}s — longer than the typical ${expSec}s. Hang tight.`;
    }
    const remaining = Math.max(0, expSec - elapsedSec);
    return `Running ${elapsedSec}s · ~${remaining}s left (typical ${expSec}s)`;
  }

  function applyProgressVisual(btn, elapsedMs, expectedMs) {
    if (!expectedMs) {
      return;
    }
    const pct = Math.min(100, (elapsedMs / expectedMs) * 100);
    btn.style.setProperty("--bon-progress", `${pct.toFixed(1)}%`);
    btn.classList.toggle("bon-progress--overtime", elapsedMs > expectedMs);
  }

  function render() {
    expectedDurationMs = computeExpectedDurationMs();
    const query = searchInput.value.trim().toLowerCase();

    const filtered = allReports.filter((r) => {
      if (!query) {
        return true;
      }
      const haystack = [
        r.username,
        ...(r.history || []).flatMap((h) => [h.subreddit, h.postTitle]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    filtered.sort(compareBy(sortKey, sortDir));

    updateSortIndicators();

    tbody.replaceChildren();
    if (filtered.length === 0) {
      tableWrap.hidden = true;
      emptyEl.hidden = false;
      renderEmptyState(query);
      clearBtn.hidden = allReports.length === 0;
      ensurePolling();
      return;
    }

    tableWrap.hidden = false;
    emptyEl.hidden = true;
    clearBtn.hidden = false;

    for (const report of filtered) {
      const { summary, detailRows } = renderReportRow(report);
      tbody.appendChild(summary);
      for (const row of detailRows) {
        tbody.appendChild(row);
      }
    }

    ensurePolling();
  }

  function sanitizeUsernameQuery(raw) {
    const trimmed = (raw || "").trim().replace(/^\/?u\//i, "");
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  function renderEmptyState(query) {
    emptyEl.replaceChildren();
    const text = document.createElement("p");
    text.className = "bon-empty-text";
    if (allReports.length === 0 && !query) {
      text.textContent =
        "No reports yet. Flag a Reddit user from their profile page to start tracking.";
    } else {
      text.textContent = "No reports match the search.";
    }
    emptyEl.appendChild(text);

    if (!query) {
      return;
    }
    const username = sanitizeUsernameQuery(query);
    if (!username) {
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-btn bon-empty-action";
    btn.textContent = `Investigate u/${username}`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Starting…";
      try {
        void browser.runtime.sendMessage({
          type: "investigate-user",
          username,
        });
        searchInput.value = "";
        sortKey = "investigatedAt";
        sortDir = "desc";
        updateSortIndicators();
        render();
      } catch (err) {
        console.error("[Bot or Not] manual investigate failed", err);
        btn.disabled = false;
        btn.textContent = `Investigate u/${username}`;
      }
    });
    emptyEl.appendChild(btn);
  }

  function ensurePolling() {
    const anyLive = allReports.some(
      (r) =>
        r.investigation?.status === "running" &&
        !bonIsInvestigationStale(r.investigation)
    );
    if (anyLive && !pollTimer) {
      pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
    } else if (!anyLive && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Poll tick: fetch fresh data but only do a full re-render if something
  // structural changed. For a running investigation, just update the elapsed
  // time text in place — re-rendering destroys the spinning button DOM and
  // restarts its CSS animation, causing a visible jitter every tick.
  async function pollTick() {
    try {
      const { reports = {} } = await browser.runtime.sendMessage({
        type: "get-all-reports",
      });
      const fresh = Object.entries(reports).map(([username, data]) => ({
        username,
        ...data,
      }));
      const structuralChange = hasStructuralChange(allReports, fresh);
      allReports = fresh;
      if (structuralChange) {
        render();
        renderAnalytics();
      } else {
        updateRunningInPlace();
        ensurePolling();
      }
    } catch (err) {
      console.error("[Bot or Not] poll tick failed", err);
    }
  }

  function hasStructuralChange(prev, next) {
    if (prev.length !== next.length) {
      return true;
    }
    const prevByUser = new Map(prev.map((r) => [r.username, r]));
    for (const r of next) {
      const p = prevByUser.get(r.username);
      if (!p) {
        return true;
      }
      const ps = p.investigation?.status;
      const ns = r.investigation?.status;
      if (ps !== ns) {
        return true;
      }
      if (p.investigation?.verdict !== r.investigation?.verdict) {
        return true;
      }
      if (p.count !== r.count) {
        return true;
      }
      if (p.lastReportedAt !== r.lastReportedAt) {
        return true;
      }
      const pStale =
        ps === "running" && bonIsInvestigationStale(p.investigation);
      const nStale =
        ns === "running" && bonIsInvestigationStale(r.investigation);
      if (pStale !== nStale) {
        return true;
      }
    }
    return false;
  }

  function updateRunningInPlace() {
    // Recompute in case a run completed between full renders and we have a
    // new sample for the median (no full re-render fires for that alone).
    expectedDurationMs = computeExpectedDurationMs();
    for (const r of allReports) {
      const inv = r.investigation;
      if (inv?.status !== "running") {
        continue;
      }
      if (bonIsInvestigationStale(inv)) {
        continue;
      }
      if (!inv.startedAt) {
        continue;
      }
      const elapsedMs = Math.max(0, Date.now() - inv.startedAt);
      const elapsedSec = Math.round(elapsedMs / 1000);
      const cells = tbody.querySelectorAll("[data-bon-running-cell]");
      for (const cell of cells) {
        if (cell.dataset.bonRunningCell === r.username) {
          cell.textContent = formatRunningCellText(
            elapsedSec,
            expectedDurationMs
          );
        }
      }
      const btns = tbody.querySelectorAll("[data-bon-running-btn]");
      for (const btn of btns) {
        if (btn.dataset.bonRunningBtn !== r.username) {
          continue;
        }
        btn.title = formatRunningTitle(elapsedSec, expectedDurationMs);
        if (btn.classList.contains("bon-progress") && expectedDurationMs) {
          applyProgressVisual(btn, elapsedMs, expectedDurationMs);
        }
      }
    }
  }

  function updateSortIndicators() {
    document.querySelectorAll("th.bon-sortable").forEach((th) => {
      const indicator = th.querySelector(".bon-sort-indicator");
      if (th.dataset.sort === sortKey) {
        indicator.textContent = sortDir === "asc" ? "▲" : "▼";
      } else {
        indicator.textContent = "";
      }
    });
  }

  function defaultDirFor(key) {
    if (key === "username" || key === "verdict") {
      return "asc";
    }
    return "desc";
  }

  function compareBy(key, dir) {
    const mult = dir === "asc" ? 1 : -1;
    return (a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av == null && bv == null) {
        return 0;
      }
      if (av == null) {
        return 1;
      }
      if (bv == null) {
        return -1;
      }
      if (av < bv) {
        return -1 * mult;
      }
      if (av > bv) {
        return 1 * mult;
      }
      const aTime = a.lastReportedAt || 0;
      const bTime = b.lastReportedAt || 0;
      return bTime - aTime;
    };
  }

  function sortValue(r, key) {
    if (key === "username") {
      return r.username.toLowerCase();
    }
    if (key === "count") {
      return r.count || 0;
    }
    if (key === "lastReportedAt") {
      return r.lastReportedAt || 0;
    }
    if (key === "verdict") {
      const v = r.investigation?.verdict;
      return VERDICT_RANK[v] ?? 5;
    }
    if (key === "investigatedAt") {
      const inv = r.investigation;
      if (!inv) {
        return 0;
      }
      // While running, runAt isn't written yet — fall back to startedAt so a
      // freshly-kicked-off investigation sorts to the top instead of the bottom.
      return inv.runAt || inv.startedAt || 0;
    }
    if (key === "region") {
      // Sort by region label so same-country rows cluster; rows with no
      // inferred region sink to the bottom.
      const region = computeRegionForReport(r);
      if (!region) {
        return "￿";
      }
      if (region.kind === "deterministic") {
        return (BON_REGION_INFO[region.region]?.label || region.region) + "_a";
      }
      // timezone-only sorts after subreddit-based hits regardless of label
      return "￾_" + (region.offsetHours ?? 99);
    }
    return null;
  }

  function computeRegionForReport(report) {
    const activityData = report.activityData;
    const timestamps = [
      ...(activityData?.postTimestamps || []),
      ...(activityData?.commentTimestamps || []),
    ];
    const tz =
      typeof inferTimezoneFromTimestamps === "function"
        ? inferTimezoneFromTimestamps(timestamps)
        : null;
    return bonInferRegion(activityData, tz);
  }

  function renderReportRow(report) {
    const { username, lastReportedAt, history, investigation } = report;

    const summary = document.createElement("tr");
    summary.className = "bon-row-summary";

    const hasHistory = history && history.length > 0;
    const hasInvestigation =
      !!investigation &&
      (investigation.verdict ||
        investigation.status === "error" ||
        investigation.status === "running");
    const expandable = true;

    const detailRows = [];
    let activityCellRef = null;

    const expandCell = document.createElement("td");
    if (expandable) {
      const expandBtn = document.createElement("button");
      expandBtn.className = "bon-expand-btn";
      expandBtn.setAttribute(
        "aria-expanded",
        expanded.has(username) ? "true" : "false"
      );
      expandBtn.setAttribute("aria-label", "Show details");
      expandBtn.textContent = "▶";
      expandBtn.addEventListener("click", () => {
        const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
        const next = !isExpanded;
        expandBtn.setAttribute("aria-expanded", String(next));
        for (const row of detailRows) {
          row.hidden = !next;
        }
        if (next) {
          expanded.add(username);
          if (
            activityCellRef &&
            !isActivityFresh(report.activityData) &&
            !inflightActivity.has(username)
          ) {
            if (!report.activityData) {
              activityCellRef.replaceChildren(
                renderActivityLoadingPlaceholder()
              );
            }
            loadActivityIfStale(username, report.activityData);
          }
        } else {
          expanded.delete(username);
        }
      });
      expandCell.appendChild(expandBtn);
    }
    summary.appendChild(expandCell);

    const userCell = document.createElement("td");
    const nameWrap = document.createElement("span");
    nameWrap.className = "bon-username-cell";
    const link = document.createElement("a");
    link.href = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `u/${username}`;
    nameWrap.appendChild(link);
    userCell.appendChild(nameWrap);
    summary.appendChild(userCell);

    const regionCell = document.createElement("td");
    regionCell.className = "bon-region-cell";
    regionCell.appendChild(renderRegionBadge(report));
    summary.appendChild(regionCell);

    const verdictCell = document.createElement("td");
    const verdictEl = verdictBadge(investigation);
    if (verdictEl) {
      verdictCell.appendChild(verdictEl);
    } else {
      const dash = document.createElement("span");
      dash.className = "bon-bb-empty";
      dash.textContent = "—";
      verdictCell.appendChild(dash);
    }
    summary.appendChild(verdictCell);

    const factorsCell = document.createElement("td");
    factorsCell.appendChild(renderFactorDots(investigation));
    summary.appendChild(factorsCell);

    const investigatedCell = document.createElement("td");
    investigatedCell.className = "bon-investigated-cell";
    populateInvestigatedCell(investigatedCell, investigation);
    if (
      investigation?.status === "running" &&
      !bonIsInvestigationStale(investigation)
    ) {
      investigatedCell.dataset.bonRunningCell = username;
    }
    summary.appendChild(investigatedCell);

    const dateCell = document.createElement("td");
    dateCell.className = "bon-cell-muted";
    if (lastReportedAt) {
      dateCell.textContent = bonFormatDate(lastReportedAt);
      dateCell.title = new Date(lastReportedAt).toLocaleString();
    } else {
      dateCell.textContent = "—";
    }
    summary.appendChild(dateCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "bon-actions-cell";
    const investigateBtn = renderInvestigateButton(username, investigation);
    actionsCell.appendChild(investigateBtn);
    actionsCell.appendChild(renderDeleteButton(username));
    summary.appendChild(actionsCell);

    const startCollapsed = !expanded.has(username);

    if (hasInvestigation) {
      const investigationRow = document.createElement("tr");
      investigationRow.className = "bon-row-history";
      investigationRow.hidden = startCollapsed;
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.appendChild(renderInvestigationDetail(investigation));
      investigationRow.appendChild(cell);
      detailRows.push(investigationRow);
    }

    if (expandable) {
      const activityRow = document.createElement("tr");
      activityRow.className = "bon-row-history";
      activityRow.hidden = startCollapsed;
      const activityCell = document.createElement("td");
      activityCell.colSpan = 8;
      if (inflightActivity.has(username) && !report.activityData) {
        activityCell.appendChild(renderActivityLoadingPlaceholder());
      } else {
        activityCell.appendChild(renderActivitySection(report));
      }
      activityRow.appendChild(activityCell);
      detailRows.push(activityRow);
      activityCellRef = activityCell;
    }

    let historyRow = null;
    if (hasHistory) {
      historyRow = document.createElement("tr");
      historyRow.className = "bon-row-history";
      historyRow.hidden = startCollapsed;
      const historyCell = document.createElement("td");
      historyCell.colSpan = 8;
      const wrap = document.createElement("div");
      wrap.className = "bon-detail-wrap";
      const title = document.createElement("p");
      title.className = "bon-detail-title";
      title.textContent = "Report history";
      wrap.appendChild(title);
      wrap.appendChild(renderHistoryTable(history));
      historyCell.appendChild(wrap);
      historyRow.appendChild(historyCell);
      detailRows.push(historyRow);
    }

    return { summary, detailRows };
  }

  function renderHistoryTable(history) {
    const table = document.createElement("table");
    table.className = "bon-history-table";
    const tbodyEl = document.createElement("tbody");
    const sorted = [...history].sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const entry of sorted) {
      tbodyEl.appendChild(renderHistoryEntry(entry));
    }
    table.appendChild(tbodyEl);
    return table;
  }

  function renderHistoryEntry(entry) {
    const tr = document.createElement("tr");

    const dateCell = document.createElement("td");
    if (entry.at) {
      const d = new Date(entry.at);
      const sameYear = d.getFullYear() === new Date().getFullYear();
      const dateLine = document.createElement("span");
      dateLine.className = "bon-history-date";
      dateLine.textContent = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: sameYear ? undefined : "2-digit",
      });
      const timeLine = document.createElement("span");
      timeLine.className = "bon-history-time";
      timeLine.textContent = d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      dateCell.appendChild(dateLine);
      dateCell.appendChild(timeLine);
      dateCell.title = d.toLocaleString();
    } else {
      dateCell.textContent = "unknown";
    }
    tr.appendChild(dateCell);

    const kindCell = document.createElement("td");
    const leadIcon =
      statusIcon(entry.status, "post") || kindIconFor(entry.kind);
    if (leadIcon) {
      kindCell.appendChild(leadIcon);
    }
    tr.appendChild(kindCell);

    const labelCell = document.createElement("td");
    const targetUrl = resolveUrl(entry.permalink) || entry.sourceUrl;
    const labelParts = [];
    if (entry.subreddit) {
      labelParts.push(entry.subreddit);
    }
    if (entry.postTitle) {
      labelParts.push(entry.postTitle);
    }
    const label = labelParts.join(" · ") || targetUrl || "report";
    if (targetUrl) {
      const a = document.createElement("a");
      a.href = targetUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      a.title = label;
      labelCell.appendChild(a);
    } else {
      labelCell.textContent = label;
      labelCell.title = label;
    }
    tr.appendChild(labelCell);

    return tr;
  }

  function verdictBadge(rawInvestigation) {
    if (!rawInvestigation) {
      return null;
    }
    if (rawInvestigation.status === "running") {
      const stale = bonIsInvestigationStale(rawInvestigation);
      const span = document.createElement("span");
      span.className = `bon-verdict-badge bon-verdict-badge--${stale ? "error" : "running"}`;
      span.textContent = stale ? "Stalled" : "Running";
      span.title = stale
        ? "Investigation appears orphaned — click the retry button to re-run"
        : "Investigation in progress";
      return span;
    }
    if (rawInvestigation.status === "error") {
      const span = document.createElement("span");
      span.className = "bon-verdict-badge bon-verdict-badge--error";
      span.textContent = "Error";
      span.title = rawInvestigation.error || "Investigation failed";
      return span;
    }
    const investigation = bonNormalizeInvestigation(rawInvestigation);
    if (!investigation.verdict) {
      return null;
    }
    const span = document.createElement("span");
    span.className = `bon-verdict-badge bon-verdict-badge--${investigation.verdict}`;
    span.textContent = bonFormatVerdict(investigation.verdict);
    span.title = investigation.summary || investigation.verdict;
    return span;
  }

  // Assemble the badge hover tooltip by listing every source that contributed
  // to the region pick, plus the timezone agreement and runner-up. Aims to
  // make the operator audit-able: "yes, here's exactly why we said India."
  function formatRegionTooltip(region, info) {
    const lines = [`${info.label} — combined region signal:`];
    if (region.subreddit) {
      const hitsSummary = region.subreddit.hits
        .slice(0, 4)
        .map(({ sub, count }) => `r/${sub}${count > 1 ? ` ×${count}` : ""}`)
        .join(", ");
      const more =
        region.subreddit.hits.length > 4
          ? ` +${region.subreddit.hits.length - 4} more`
          : "";
      lines.push(
        `• ${region.subreddit.count} item${region.subreddit.count === 1 ? "" : "s"} in ${info.label}-coded subreddits (${hitsSummary}${more})`
      );
    }
    if (region.scriptSignal) {
      const scriptSummary = region.scriptSignal.hits
        .map((h) => `${h.count} ${h.script}`)
        .join(", ");
      lines.push(`• Script in their writing: ${scriptSummary}`);
    }
    if (region.languageSignal) {
      const langSummary = region.languageSignal.hits
        .map((h) => `${h.count} ${h.label}`)
        .join(", ");
      lines.push(`• Language markers in their writing: ${langSummary}`);
    }
    if (region.moderator) {
      const modList = region.moderator.hits
        .slice(0, 3)
        .map((h) => `r/${h.sub}`)
        .join(", ");
      lines.push(
        `• Moderates ${region.moderator.score} ${info.label}-coded sub${region.moderator.score === 1 ? "" : "s"} (${modList})`
      );
    }
    if (region.tzMatch === true) {
      lines.push(
        `• Posting timezone UTC${region.tzOffset >= 0 ? "+" : ""}${region.tzOffset} matches ${info.label}`
      );
    } else if (region.tzMatch === false) {
      lines.push(
        `⚠ Posting timezone UTC${region.tzOffset >= 0 ? "+" : ""}${region.tzOffset} does NOT match — possible operator in a different country`
      );
    }
    if (region.runnerUp) {
      const r = BON_REGION_INFO[region.runnerUp.region];
      lines.push(
        `(runner-up: ${r?.label || region.runnerUp.region} with score ${region.runnerUp.score.toFixed(1)})`
      );
    }
    return lines.join("\n");
  }

  function renderRegionBadge(report) {
    const region = computeRegionForReport(report);
    if (!region) {
      const dash = document.createElement("span");
      dash.className = "bon-bb-empty";
      dash.textContent = "—";
      if (!report.activityData) {
        dash.title =
          "Activity not loaded yet — expand the row or run an investigation to populate.";
      } else if (!report.activityData.subredditCounts) {
        dash.title =
          "Activity data was fetched before subreddit-region tracking was added. Click ↻ refresh in the heatmap to re-fetch and populate this column.";
      } else {
        dash.title =
          "No region-specific subreddits in this account's recent activity, and no clear daily sleep cycle for timezone inference.";
      }
      return dash;
    }

    if (region.kind === "deterministic") {
      const info = BON_REGION_INFO[region.region] || {
        flag: "🏳",
        label: region.region,
      };
      const badge = document.createElement("span");
      let tzClass = "";
      if (region.tzMatch === true) {
        tzClass = " bon-region-badge--tz-match";
      } else if (region.tzMatch === false) {
        tzClass = " bon-region-badge--tz-mismatch";
      }
      badge.className = `bon-region-badge${tzClass}`;

      const flag = document.createElement("span");
      flag.className = "bon-region-flag";
      flag.textContent = info.flag;
      // Tooltip on the flag itself for quick "what country is this?" hover —
      // labels sit next to the flag too, but a flag-only glance should be
      // self-explanatory.
      flag.title = info.label;
      badge.appendChild(flag);

      const label = document.createElement("span");
      label.textContent = info.label;
      badge.appendChild(label);

      badge.title = formatRegionTooltip(region, info);
      return badge;
    }

    // timezone-only — weak signal, render as muted text
    const span = document.createElement("span");
    span.className = "bon-region-tz-only";
    const offset = region.offsetHours;
    const sign = offset >= 0 ? "+" : "";
    span.textContent = `UTC${sign}${offset}`;
    const candidates = region.possibleRegions
      .map((code) => BON_REGION_INFO[code]?.label)
      .filter(Boolean);
    span.title = candidates.length
      ? `Timezone-only inference. Posting hours cluster around UTC${sign}${offset} — possible regions: ${candidates.join(", ")}. No country-coded subreddits in activity.`
      : `Timezone-only inference. Posting hours cluster around UTC${sign}${offset}. No country-coded subreddits in activity.`;
    return span;
  }

  // Compact factor strip rendered in the always-visible row cell. Each dot is
  // a small colored square tinted by its signal leaning. On hover/focus the
  // dot surfaces a richer card-style popover with reasoning + evidence + a
  // score bar — see `buildFactorTooltipCard` below. The popover sits in the
  // dot's DOM so a single CSS rule (`:hover`/`:focus-within`) reveals it.
  function renderFactorDots(investigation) {
    const wrap = document.createElement("span");
    wrap.className = "bon-factors-cell";
    const factorsByKey = new Map();
    if (Array.isArray(investigation?.factors)) {
      for (const f of investigation.factors) {
        if (f?.key) {
          factorsByKey.set(f.key, f);
        }
      }
    }
    // Treat "missing" specially only when the investigation actually ran
    // (status done). A never-run investigation gets the plain "missing" dots
    // without the "added after" framing.
    const hasRun = investigation?.status === "done";
    for (const key of FACTOR_KEYS) {
      const f = factorsByKey.get(key);
      wrap.appendChild(buildFactorDot(key, f, hasRun));
    }
    return wrap;
  }

  function buildFactorDot(key, f, hasRun) {
    const fullLabel = FACTOR_LABELS[key] || key;

    const dot = document.createElement("span");
    dot.className = "bon-factor-dot";
    dot.tabIndex = 0;

    let leaning;
    if (f && typeof f.score === "number") {
      leaning = bonScoreLeaning(f.score, f.confidence);
    } else if (!f && hasRun) {
      leaning = "new";
    } else if (!f) {
      leaning = "missing";
    } else {
      leaning = "neutral";
    }
    dot.classList.add(`bon-factor-dot--${leaning}`);

    // Plain-text fallback for screen readers / no-hover contexts.
    if (f) {
      const scoreText = typeof f.score === "number" ? f.score.toFixed(2) : "—";
      const confText =
        typeof f.confidence === "number"
          ? `${Math.round(f.confidence * 100)}%`
          : "—";
      dot.setAttribute(
        "aria-label",
        `${fullLabel}: score ${scoreText}, confidence ${confText}`
      );
    } else if (hasRun) {
      dot.setAttribute(
        "aria-label",
        `${fullLabel}: added after this investigation ran — re-run to score`
      );
    } else {
      dot.setAttribute("aria-label", `${fullLabel}: not investigated`);
    }

    const card = buildFactorTooltipCard(fullLabel, f, hasRun, leaning);
    dot.appendChild(card);
    attachFactorCardPositioning(dot, card);

    return dot;
  }

  // Factor tooltip is position: fixed and gets hoisted to <body> on first
  // hover. The dot lives inside a table cell with its own containing block
  // and overflow rules; appending to body guarantees the card sits directly
  // under <html> so fixed positioning resolves against the true viewport.
  // Coords are computed from the dot's bounding rect: above the dot when
  // there's headroom, flipped below otherwise, and clamped to an 8px margin
  // on the sides so wide cards don't bleed past the viewport.
  function attachFactorCardPositioning(dotEl, cardEl) {
    let mounted = false;
    const show = () => {
      if (!mounted) {
        document.body.appendChild(cardEl);
        mounted = true;
      }
      const dotRect = dotEl.getBoundingClientRect();
      const cardWidth = cardEl.offsetWidth;
      const cardHeight = cardEl.offsetHeight;
      if (!cardWidth || !cardHeight) {
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      const gap = 10;

      let left = dotRect.left + dotRect.width / 2 - cardWidth / 2;
      left = Math.max(margin, Math.min(left, vw - margin - cardWidth));

      let top = dotRect.top - cardHeight - gap;
      if (top < margin) {
        top = dotRect.bottom + gap;
      }
      top = Math.max(margin, Math.min(top, vh - margin - cardHeight));

      cardEl.style.left = `${left}px`;
      cardEl.style.top = `${top}px`;
      cardEl.classList.add("bon-factor-card--visible");
    };
    const hide = () => {
      cardEl.classList.remove("bon-factor-card--visible");
    };
    dotEl.addEventListener("mouseenter", show);
    dotEl.addEventListener("mouseleave", hide);
    dotEl.addEventListener("focus", show);
    dotEl.addEventListener("blur", hide);
  }

  // Hover card content for a factor chip. Styled to read like the editorial-
  // dossier factor cards on the expanded view — same header layout, score bar,
  // reasoning, evidence list. Always present in the DOM so :hover can reveal
  // it without JS; browsers handle hundreds of hidden subtrees comfortably.
  function buildFactorTooltipCard(fullLabel, f, hasRun, leaning) {
    const card = document.createElement("span");
    // Leaning modifier carries --bon-factor-accent forward when the card is
    // hoisted to <body> for positioning; otherwise inheritance from the dot
    // is severed and the colored top border goes muted.
    card.className = `bon-factor-card bon-factor-card--${leaning}`;
    card.setAttribute("role", "tooltip");

    const header = document.createElement("span");
    header.className = "bon-factor-card-header";
    const name = document.createElement("span");
    name.className = "bon-factor-card-name";
    name.textContent = fullLabel;
    header.appendChild(name);

    if (f && typeof f.score === "number") {
      const pillClass =
        leaning === "likely-bot"
          ? "bot"
          : leaning === "likely-human"
            ? "human"
            : leaning === "missing"
              ? "neutral"
              : leaning;
      const pill = document.createElement("span");
      pill.className = `bon-factor-signal bon-factor-signal--${pillClass}`;
      pill.textContent =
        leaning === "neutral" || leaning === "missing"
          ? "Neutral"
          : bonFormatVerdict(leaning);
      header.appendChild(pill);
    }
    card.appendChild(header);

    if (f && typeof f.score === "number") {
      card.appendChild(renderScoreBar(f.score, f.confidence));
    }

    if (f && typeof f.confidence === "number") {
      const conf = document.createElement("span");
      conf.className = "bon-factor-card-confidence";
      conf.textContent = `${Math.round(f.confidence * 100)}% confidence`;
      card.appendChild(conf);
    }

    if (f?.reasoning) {
      const r = document.createElement("span");
      r.className = "bon-factor-card-reasoning";
      r.textContent = f.reasoning;
      card.appendChild(r);
    } else if (!f && hasRun) {
      const r = document.createElement("span");
      r.className =
        "bon-factor-card-reasoning bon-factor-card-reasoning--muted";
      r.textContent = "Added after this investigation ran — re-run to score.";
      card.appendChild(r);
    } else if (!f) {
      const r = document.createElement("span");
      r.className =
        "bon-factor-card-reasoning bon-factor-card-reasoning--muted";
      r.textContent = "Not investigated.";
      card.appendChild(r);
    }

    if (f && Array.isArray(f.evidence) && f.evidence.length) {
      const list = document.createElement("ul");
      list.className = "bon-factor-card-evidence";
      for (const cite of f.evidence) {
        const item = document.createElement("li");
        item.textContent = cite;
        list.appendChild(item);
      }
      card.appendChild(list);
    }

    return card;
  }

  function buildTopReasonsList(factors) {
    const top = bonTopReasons(factors, 3);
    if (!top.length) {
      return null;
    }
    const ul = document.createElement("ul");
    ul.className = "bon-top-reasons";
    for (const f of top) {
      const li = document.createElement("li");
      const leaning = bonScoreLeaning(f.score, f.confidence);
      li.className = `bon-reason bon-reason--${leaning}`;
      const bullet = document.createElement("span");
      bullet.className = "bon-reason__bullet";
      bullet.setAttribute("aria-hidden", "true");
      li.appendChild(bullet);
      const text = document.createElement("span");
      text.className = "bon-reason__text";
      const label = document.createElement("strong");
      label.textContent = FACTOR_LABELS[f.key] || f.name || f.key || "Factor";
      text.appendChild(label);
      if (f.reasoning) {
        text.appendChild(document.createTextNode(` — ${f.reasoning}`));
      }
      li.appendChild(text);
      ul.appendChild(li);
    }
    return ul;
  }

  function populateInvestigatedCell(cell, investigation) {
    if (!investigation || (!investigation.runAt && !investigation.startedAt)) {
      cell.textContent = "—";
      cell.classList.add("bon-cell-muted");
      return;
    }
    if (investigation.status === "running") {
      const stale = bonIsInvestigationStale(investigation);
      if (stale) {
        cell.textContent = "Stalled";
      } else if (investigation.startedAt) {
        const elapsed = Math.max(
          0,
          Math.round((Date.now() - investigation.startedAt) / 1000)
        );
        cell.textContent = formatRunningCellText(elapsed, expectedDurationMs);
      } else {
        cell.textContent = "Running…";
      }
      if (investigation.startedAt) {
        const started = new Date(investigation.startedAt).toLocaleString();
        cell.title = stale
          ? `Stalled — started ${started}, never completed`
          : `Started ${started}`;
      }
      return;
    }
    const when = document.createElement("span");
    when.textContent = investigation.runAt
      ? bonFormatDate(investigation.runAt)
      : "—";
    if (investigation.runAt) {
      when.title = new Date(investigation.runAt).toLocaleString();
    }
    cell.appendChild(when);
    if (typeof investigation.durationMs === "number") {
      const dur = document.createElement("span");
      dur.className = "bon-duration";
      dur.textContent = `Took ${bonFmtDuration(investigation.durationMs)}`;
      cell.appendChild(dur);
    }
  }

  function renderInvestigateButton(username, investigation) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-investigate-btn";
    const running = investigation?.status === "running";
    const stale = running && bonIsInvestigationStale(investigation);
    const verdict = investigation?.verdict;
    if (running && !stale) {
      btn.textContent = "";
      btn.disabled = true;
      btn.dataset.bonRunningBtn = username;
      const startedAt = investigation.startedAt || Date.now();
      btn.dataset.bonRunningStartedAt = String(startedAt);
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const elapsedSec = Math.round(elapsedMs / 1000);
      if (expectedDurationMs) {
        btn.classList.add("bon-progress");
        applyProgressVisual(btn, elapsedMs, expectedDurationMs);
      } else {
        btn.classList.add("bon-spinning");
      }
      btn.title = formatRunningTitle(elapsedSec, expectedDurationMs);
    } else if (stale) {
      btn.textContent = "🔁";
      btn.title = "Retry stalled investigation";
    } else if (verdict) {
      btn.textContent = "🔁";
      btn.title = "Re-run AI investigation";
    } else {
      btn.textContent = "🤖";
      btn.title = "Run AI investigation";
    }
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.classList.add("bon-spinning");
      btn.textContent = "";
      try {
        const res = await browser.runtime.sendMessage({
          type: "investigate-user",
          username,
        });
        if (res?.ok === false && res.error === "no-api-key") {
          openSettings();
        }
        // storage.onChanged will reload and re-render.
      } catch (err) {
        console.error("[Bot or Not] investigate failed", err);
        btn.disabled = false;
        btn.classList.remove("bon-spinning");
        btn.textContent = verdict ? "🔁" : "🤖";
      }
    });
    return btn;
  }

  function renderDeleteButton(username) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-investigate-btn bon-delete-btn";
    btn.textContent = "🗑";
    btn.title = `Delete report for u/${username}`;
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", () => {
      openConfirmModal({
        text: `Delete the report for u/${username}? This can't be undone.`,
        confirmLabel: "Delete",
        action: () =>
          browser.runtime.sendMessage({ type: "delete-report", username }),
      });
    });
    return btn;
  }

  function renderInvestigationDetail(rawInvestigation) {
    const investigation = bonNormalizeInvestigation(rawInvestigation);
    const wrap = document.createElement("div");
    wrap.className = "bon-detail-wrap";

    const title = document.createElement("p");
    title.className = "bon-detail-title";
    title.textContent = "AI investigation";
    wrap.appendChild(title);

    if (investigation.status === "running") {
      const stale = bonIsInvestigationStale(investigation);
      const p = document.createElement("p");
      p.className = "bon-verdict-meta";
      if (stale) {
        p.textContent = investigation.startedAt
          ? `Stalled — started ${new Date(investigation.startedAt).toLocaleString()}, never completed. Click the retry button above to re-run.`
          : "Stalled — never completed. Click the retry button above to re-run.";
      } else {
        p.textContent = investigation.startedAt
          ? `Running since ${new Date(investigation.startedAt).toLocaleString()}…`
          : "Running…";
      }
      wrap.appendChild(p);
      return wrap;
    }

    if (investigation.status === "error") {
      const err = document.createElement("div");
      err.className = "bon-verdict-error";
      err.textContent = `Investigation failed: ${investigation.error || "unknown error"}`;
      wrap.appendChild(err);
      return wrap;
    }

    const summaryCol = document.createElement("div");
    summaryCol.className = "bon-summary-col";

    if (investigation.summary) {
      const summary = document.createElement("p");
      summary.className = "bon-verdict-summary";
      summary.textContent = investigation.summary;
      summaryCol.appendChild(summary);
    }

    if (Array.isArray(investigation.factors) && investigation.factors.length) {
      const reasons = buildTopReasonsList(investigation.factors);
      if (reasons) {
        summaryCol.appendChild(reasons);
      }
    }

    const personaBlock = renderPersonaBlock(investigation.persona);

    if (personaBlock && summaryCol.childNodes.length) {
      const row = document.createElement("div");
      row.className = "bon-summary-row";
      row.appendChild(summaryCol);
      row.appendChild(personaBlock);
      wrap.appendChild(row);
    } else {
      if (summaryCol.childNodes.length) {
        wrap.appendChild(summaryCol);
      }
      if (personaBlock) {
        wrap.appendChild(personaBlock);
      }
    }

    const meta = document.createElement("p");
    meta.className = "bon-verdict-meta";
    const metaParts = [];
    if (typeof investigation.confidence === "number") {
      metaParts.push(
        `overall confidence ${Math.round(investigation.confidence * 100)}%`
      );
    }
    if (investigation.model) {
      metaParts.push(investigation.model);
    }
    if (investigation.runAt) {
      const ts = new Date(investigation.runAt).toLocaleString();
      metaParts.push(`run ${ts}`);
    }
    if (typeof investigation.durationMs === "number") {
      metaParts.push(`took ${bonFmtDuration(investigation.durationMs)}`);
    }
    if (typeof investigation.postsFetched === "number") {
      metaParts.push(
        `${investigation.postsFetched} posts, ${investigation.commentsFetched ?? 0} comments analyzed`
      );
    }
    if (typeof investigation.webSearchCount === "number") {
      metaParts.push(
        investigation.webSearchCount > 0
          ? `🌐 web search: ${investigation.webSearchCount}`
          : "🌐 web search: skipped"
      );
    }
    meta.textContent = metaParts.join(" · ");
    wrap.appendChild(meta);

    if (Array.isArray(investigation.factors) && investigation.factors.length) {
      const ul = document.createElement("ul");
      ul.className = "bon-verdict-factors";
      const byKey = new Map(investigation.factors.map((f) => [f.key, f]));
      // Walk the canonical key list so factors added since the report ran
      // appear as placeholder cards in the right position, and stored factors
      // that have since been removed from the schema are dropped.
      for (const key of FACTOR_KEYS) {
        const f = byKey.get(key);
        if (f) {
          ul.appendChild(renderFactor(f));
        } else {
          ul.appendChild(renderMissingFactor(key));
        }
      }
      wrap.appendChild(ul);
    }

    return wrap;
  }

  // Persona block: radar chart of archetype strengths + dominant label + the
  // LLM's one-line reasoning. Returns null if the investigation has no persona
  // data at all. Legacy investigations stored before the radar (no
  // `archetypes`) still render — just the label + reasoning, no chart.
  function renderPersonaBlock(persona) {
    if (!persona || !persona.label) {
      return null;
    }

    const block = document.createElement("aside");
    block.className = `bon-persona bon-persona--${persona.label}`;

    const heading = document.createElement("p");
    heading.className = "bon-persona-heading";
    heading.textContent = "Persona profile";
    block.appendChild(heading);

    if (persona.archetypes) {
      const radar = renderPersonaRadar(persona.archetypes);
      if (radar) {
        block.appendChild(radar);
      }
    }

    const labelText =
      persona.label === "normal"
        ? "Normal"
        : BON_ARCHETYPES.find((a) => a.key === persona.label)?.label ||
          persona.label;

    const label = document.createElement("p");
    label.className = `bon-persona-label bon-persona-label--${persona.label}`;
    label.textContent = labelText;
    block.appendChild(label);

    if (persona.reasoning) {
      const blurb = document.createElement("p");
      blurb.className = "bon-persona-blurb";
      blurb.textContent = persona.reasoning;
      block.appendChild(blurb);
    }

    return block;
  }

  function renderPersonaRadar(archetypes) {
    if (!archetypes) {
      return null;
    }
    const svgns = "http://www.w3.org/2000/svg";
    // Vertices are laid out starting at top (12 o'clock) and going clockwise,
    // one per BON_ARCHETYPES entry — chart grows if a new archetype is added.
    const v = {
      size: 220,
      center: 110,
      radius: 76,
      labelPad: 14,
      gridLevels: 4,
    };
    const axes = BON_ARCHETYPES;
    const N = axes.length;
    if (N < 3) {
      return null;
    }

    const step = (Math.PI * 2) / N;
    const angle = (i) => -Math.PI / 2 + i * step;
    const vertex = (i, scale) => {
      const θ = angle(i);
      return {
        x: v.center + v.radius * scale * Math.cos(θ),
        y: v.center + v.radius * scale * Math.sin(θ),
      };
    };
    const points = (scale) =>
      axes
        .map((_, i) => {
          const p = vertex(i, scale);
          return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        })
        .join(" ");

    const wrap = document.createElement("div");
    wrap.className = "bon-persona-radar";
    wrap.title = axes
      .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
      .join("  ·  ");

    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("viewBox", `0 0 ${v.size} ${v.size}`);
    svg.setAttribute("class", "bon-radar");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `Persona radar: ${axes
        .map((a) => `${a.label} ${Math.round((archetypes[a.key] || 0) * 100)}%`)
        .join(", ")}`
    );

    // Concentric grid rings — innermost first so outer rings draw on top.
    for (let g = 1; g <= v.gridLevels; g++) {
      const poly = document.createElementNS(svgns, "polygon");
      poly.setAttribute("points", points(g / v.gridLevels));
      poly.setAttribute(
        "class",
        g === v.gridLevels
          ? "bon-radar-grid bon-radar-grid--outer"
          : "bon-radar-grid"
      );
      svg.appendChild(poly);
    }

    // Axis spokes
    for (let i = 0; i < N; i++) {
      const p = vertex(i, 1);
      const line = document.createElementNS(svgns, "line");
      line.setAttribute("x1", v.center);
      line.setAttribute("y1", v.center);
      line.setAttribute("x2", p.x.toFixed(2));
      line.setAttribute("y2", p.y.toFixed(2));
      line.setAttribute("class", "bon-radar-axis");
      svg.appendChild(line);
    }

    // Data polygon
    const dataPolyPts = axes
      .map((a, i) => {
        const score = Math.max(0, Math.min(1, archetypes[a.key] || 0));
        const p = vertex(i, score);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      })
      .join(" ");
    const dataPoly = document.createElementNS(svgns, "polygon");
    dataPoly.setAttribute("points", dataPolyPts);
    dataPoly.setAttribute("class", "bon-radar-data");
    svg.appendChild(dataPoly);

    // Tip dots — only for axes with non-trivial signal, to keep the chart
    // quiet when most axes are near zero.
    for (let i = 0; i < N; i++) {
      const score = archetypes[axes[i].key] || 0;
      if (score <= 0.05) {
        continue;
      }
      const p = vertex(i, score);
      const dot = document.createElementNS(svgns, "circle");
      dot.setAttribute("cx", p.x.toFixed(2));
      dot.setAttribute("cy", p.y.toFixed(2));
      dot.setAttribute("r", 3);
      dot.setAttribute("class", "bon-radar-dot");
      svg.appendChild(dot);
    }

    // Axis labels — anchor + baseline picked by quadrant so text reads
    // outside the chart without colliding with the vertex tip.
    for (let i = 0; i < N; i++) {
      const θ = angle(i);
      const lx = v.center + (v.radius + v.labelPad) * Math.cos(θ);
      const ly = v.center + (v.radius + v.labelPad) * Math.sin(θ);
      const cosθ = Math.cos(θ);
      const sinθ = Math.sin(θ);
      let anchor = "middle";
      if (cosθ > 0.3) {
        anchor = "start";
      } else if (cosθ < -0.3) {
        anchor = "end";
      }
      let dy = "0.35em";
      if (sinθ > 0.4) {
        dy = "0.85em";
      } else if (sinθ < -0.4) {
        dy = "-0.1em";
      }

      const text = document.createElementNS(svgns, "text");
      text.setAttribute("x", lx.toFixed(2));
      text.setAttribute("y", ly.toFixed(2));
      text.setAttribute("text-anchor", anchor);
      text.setAttribute("dy", dy);
      text.setAttribute("class", "bon-radar-label");
      text.textContent = axes[i].label;
      svg.appendChild(text);
    }

    wrap.appendChild(svg);
    return wrap;
  }

  function renderMissingFactor(key) {
    const li = document.createElement("li");
    li.className = "bon-factor bon-factor--new";

    const meta = document.createElement("div");
    meta.className = "bon-factor-meta";

    const header = document.createElement("div");
    header.className = "bon-factor-header";

    const name = document.createElement("span");
    name.className = "bon-factor-name";
    name.textContent = FACTOR_LABELS[key] || key;
    header.appendChild(name);

    const pill = document.createElement("span");
    pill.className = "bon-factor-signal bon-factor-signal--new";
    pill.textContent = "Added later";
    header.appendChild(pill);
    meta.appendChild(header);

    li.appendChild(meta);

    const note = document.createElement("div");
    note.className = "bon-factor-content";
    const inner = document.createElement("div");
    inner.className = "bon-factor-reasoning bon-factor-reasoning--muted";
    inner.textContent =
      "Added after this investigation ran. Re-run the investigation to include this factor in the verdict.";
    note.appendChild(inner);
    li.appendChild(note);

    return li;
  }

  function factorLabel(f) {
    if (f.key && FACTOR_LABELS[f.key]) {
      return FACTOR_LABELS[f.key];
    }
    if (f.name) {
      return f.name.replace(/_/g, " ");
    }
    return f.key || "Factor";
  }

  function renderFactor(f) {
    const li = document.createElement("li");
    li.className = "bon-factor";

    const meta = document.createElement("div");
    meta.className = "bon-factor-meta";

    const header = document.createElement("div");
    header.className = "bon-factor-header";

    const name = document.createElement("span");
    name.className = "bon-factor-name";
    name.textContent = factorLabel(f);
    header.appendChild(name);

    if (typeof f.score === "number") {
      const leaning = bonScoreLeaning(f.score, f.confidence);
      const pill = document.createElement("span");
      const pillClass =
        leaning === "likely-bot"
          ? "bot"
          : leaning === "likely-human"
            ? "human"
            : leaning === "missing"
              ? "neutral"
              : leaning;
      pill.className = `bon-factor-signal bon-factor-signal--${pillClass}`;
      pill.textContent =
        leaning === "neutral" || leaning === "missing"
          ? "Neutral"
          : bonFormatVerdict(leaning);
      header.appendChild(pill);
    }
    meta.appendChild(header);

    if (typeof f.score === "number") {
      meta.appendChild(renderScoreBar(f.score, f.confidence));
    }

    const subMetaParts = [];
    if (typeof f.confidence === "number") {
      subMetaParts.push(`${Math.round(f.confidence * 100)}% confidence`);
    }
    if (subMetaParts.length) {
      const sm = document.createElement("div");
      sm.className = "bon-factor-confidence";
      sm.textContent = subMetaParts.join(" · ");
      meta.appendChild(sm);
    }

    li.appendChild(meta);

    const content = document.createElement("div");
    content.className = "bon-factor-content";

    if (f.reasoning) {
      const r = document.createElement("div");
      r.className = "bon-factor-reasoning";
      r.textContent = f.reasoning;
      content.appendChild(r);
    }

    if (Array.isArray(f.evidence) && f.evidence.length) {
      const ev = document.createElement("ul");
      ev.className = "bon-factor-evidence";
      for (const cite of f.evidence) {
        const item = document.createElement("li");
        item.textContent = cite;
        ev.appendChild(item);
      }
      content.appendChild(ev);
    }

    li.appendChild(content);

    return li;
  }

  function renderScoreBar(score, confidence) {
    const clamped = Math.max(-1, Math.min(1, score));
    const conf =
      typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0;
    const bar = document.createElement("div");
    bar.className = "bon-factor-bar";
    const fill = document.createElement("div");
    const leaning = bonScoreLeaning(clamped, confidence);
    const fillClass =
      leaning === "likely-bot"
        ? "bot"
        : leaning === "likely-human"
          ? "human"
          : leaning === "missing"
            ? "neutral"
            : leaning;
    fill.className = `bon-factor-bar-fill bon-factor-bar-fill--${fillClass}`;
    fill.style.left = "0";
    fill.style.width = `${conf * 100}%`;
    bar.appendChild(fill);
    return bar;
  }

  function kindIconFor(kind) {
    if (!kind) {
      return null;
    }
    const span = document.createElement("span");
    span.className = `bon-kind-icon bon-kind-icon--${kind}`;
    if (kind === "post") {
      span.textContent = "📝";
      span.title = "Reported post";
    } else if (kind === "comment") {
      span.textContent = "💬";
      span.title = "Reported comment";
    } else {
      return null;
    }
    return span;
  }

  function statusIcon(status, scope) {
    if (!status) {
      return null;
    }
    const span = document.createElement("span");
    span.className = `bon-status-icon bon-status-icon--${status}`;
    if (status === "suspended") {
      span.textContent = "🚫";
      span.title = "Account suspended by Reddit";
    } else if (status === "deleted" && scope === "user") {
      span.textContent = "❌";
      span.title = "Account deleted";
    } else if (status === "deleted" && scope === "post") {
      span.textContent = "❌";
      span.title = "Deleted by user";
    } else if (status === "removed") {
      span.textContent = "🚫";
      span.title = "Removed by moderators";
    } else {
      return null;
    }
    return span;
  }

  function resolveUrl(permalink) {
    if (!permalink) {
      return null;
    }
    if (/^https?:\/\//i.test(permalink)) {
      return permalink;
    }
    if (permalink.startsWith("/")) {
      return `https://www.reddit.com${permalink}`;
    }
    return `https://www.reddit.com/${permalink}`;
  }

  function renderActivitySection(report) {
    const wrap = document.createElement("div");
    wrap.className = "bon-detail-wrap";

    const title = document.createElement("p");
    title.className = "bon-detail-title";
    title.textContent = "Activity heatmap";
    wrap.appendChild(title);

    const { username, activityData } = report;

    if (!activityData) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bon-heatmap-load";
      btn.textContent = "📊 Load activity";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Loading…";
        try {
          const res = await browser.runtime.sendMessage({
            type: "fetch-activity",
            username,
          });
          if (res?.ok === false) {
            btn.disabled = false;
            btn.textContent = "📊 Load activity";
            const err = document.createElement("p");
            err.className = "bon-heatmap-empty";
            err.style.color = "var(--bon-danger)";
            err.textContent = `Failed to load: ${res.error || "Unknown error"}`;
            wrap.appendChild(err);
          }
          // storage.onChanged will trigger a re-render on success.
        } catch (err) {
          console.error("[Bot or Not] fetch-activity failed", err);
          btn.disabled = false;
          btn.textContent = "📊 Load activity";
        }
      });
      wrap.appendChild(btn);
      return wrap;
    }

    const timestamps = [
      ...(activityData.postTimestamps || []),
      ...(activityData.commentTimestamps || []),
    ].sort((a, b) => a - b);

    if (timestamps.length === 0) {
      const empty = document.createElement("p");
      empty.className = "bon-heatmap-empty";
      empty.textContent = "No public posts or comments to plot.";
      wrap.appendChild(empty);
      wrap.appendChild(renderActivityRefresh(username, activityData, true));
      return wrap;
    }

    const banner = renderApiLimitBanner(activityData);
    if (banner) {
      wrap.appendChild(banner);
    }

    const meta = document.createElement("p");
    meta.className = "bon-heatmap-row";
    const postsCount = (activityData.postTimestamps || []).length;
    const commentsCount = (activityData.commentTimestamps || []).length;
    const postsLabel = postsCount === 1 ? "post" : "posts";
    const commentsLabel = commentsCount === 1 ? "comment" : "comments";
    const countSpan = document.createElement("span");
    const ps = document.createElement("strong");
    ps.textContent = String(postsCount);
    const cs = document.createElement("strong");
    cs.textContent = String(commentsCount);
    countSpan.append(ps, ` ${postsLabel} · `, cs, ` ${commentsLabel}`);
    meta.appendChild(countSpan);
    const earliest = timestamps[0];
    const earliestSpan = document.createElement("span");
    earliestSpan.textContent = `oldest visible: ${new Date(earliest).toLocaleDateString()}`;
    meta.appendChild(earliestSpan);
    meta.appendChild(renderActivityRefresh(username, activityData, false));
    wrap.appendChild(meta);

    wrap.appendChild(renderCalendarHeatmap(timestamps, activityData));
    wrap.appendChild(renderHourSection(timestamps, activityData));

    return wrap;
  }

  function renderActivityRefresh(username, activityData, standalone) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-heatmap-refresh";
    const ts = activityData?.fetchedAt
      ? new Date(activityData.fetchedAt).toLocaleString()
      : "";
    btn.textContent = standalone ? "↻ Refresh" : "↻ refresh";
    btn.title = ts ? `Fetched ${ts}` : "Refresh from Reddit";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "refreshing…";
      try {
        await browser.runtime.sendMessage({
          type: "fetch-activity",
          username,
        });
        // storage.onChanged will re-render.
      } catch (err) {
        console.error("[Bot or Not] refresh failed", err);
        btn.disabled = false;
        btn.textContent = standalone ? "↻ Refresh" : "↻ refresh";
      }
    });
    return btn;
  }

  function renderApiLimitBanner(activityData) {
    const { postsLimited, commentsLimited } = activityData;
    if (!postsLimited && !commentsLimited) {
      return null;
    }

    const earliestVisible = computeEarliestFullyVisible(activityData);
    const div = document.createElement("div");
    div.className = "bon-heatmap-banner";
    const limitedKinds = [];
    if (postsLimited) {
      limitedKinds.push("posts");
    }
    if (commentsLimited) {
      limitedKinds.push("comments");
    }
    const limitedText = limitedKinds.join(" and ");
    const dateText = earliestVisible
      ? new Date(earliestVisible).toLocaleDateString()
      : null;
    const lead = `⚠ Reddit returned the most recent ${activityData.fetchLimit || 100} ${limitedText} only.`;
    const tail = dateText
      ? ` Activity before ${dateText} may be undercounted — what looks like dormancy could just be data older than the API window.`
      : " Older activity may be missing from the heatmap.";
    div.textContent = lead + tail;
    return div;
  }

  function computeEarliestFullyVisible(activityData) {
    const { postsLimited, commentsLimited, earliestPostAt, earliestCommentAt } =
      activityData;
    const bounds = [];
    if (postsLimited && earliestPostAt) {
      bounds.push(earliestPostAt);
    }
    if (commentsLimited && earliestCommentAt) {
      bounds.push(earliestCommentAt);
    }
    if (bounds.length === 0) {
      return null;
    }
    return Math.max(...bounds);
  }

  function renderCalendarHeatmap(timestamps, activityData) {
    const earliestVisible = computeEarliestFullyVisible(activityData);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentWeekSunday = new Date(today);
    currentWeekSunday.setDate(today.getDate() - today.getDay());
    const startSunday = new Date(currentWeekSunday);
    startSunday.setDate(currentWeekSunday.getDate() - 52 * 7);

    const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const counts = new Map();
    for (const t of timestamps) {
      const d = new Date(t);
      const k = dayKey(d);
      counts.set(k, (counts.get(k) || 0) + 1);
    }

    const wrap = document.createElement("div");
    wrap.className = "bon-cal";

    const dayLabels = document.createElement("div");
    dayLabels.className = "bon-cal-days";
    for (let i = 0; i < 7; i++) {
      const d = document.createElement("div");
      // Show every other day label to reduce clutter
      d.textContent = i % 2 === 1 ? DAY_NAMES[i] : "";
      dayLabels.appendChild(d);
    }
    wrap.appendChild(dayLabels);

    const right = document.createElement("div");
    right.className = "bon-cal-right";

    // Build month runs and only label months that span at least 3 weeks,
    // so the truncated first/last month doesn't visually crash into its neighbour.
    const monthRuns = [];
    let curMonth = -1;
    for (let w = 0; w < 53; w++) {
      const sunday = new Date(startSunday);
      sunday.setDate(startSunday.getDate() + w * 7);
      const m = sunday.getMonth();
      if (m !== curMonth) {
        monthRuns.push({ startWeek: w, month: m });
        curMonth = m;
      }
    }
    monthRuns.push({ startWeek: 53, month: -1 });
    const monthLabelByWeek = new Map();
    for (let i = 0; i < monthRuns.length - 1; i++) {
      const length = monthRuns[i + 1].startWeek - monthRuns[i].startWeek;
      if (length >= 3) {
        monthLabelByWeek.set(monthRuns[i].startWeek, monthRuns[i].month);
      }
    }

    const months = document.createElement("div");
    months.className = "bon-cal-months";
    for (let w = 0; w < 53; w++) {
      const span = document.createElement("span");
      if (monthLabelByWeek.has(w)) {
        span.textContent = MONTH_NAMES[monthLabelByWeek.get(w)];
      }
      months.appendChild(span);
    }
    right.appendChild(months);

    const grid = document.createElement("div");
    grid.className = "bon-cal-grid";
    for (let w = 0; w < 53; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(startSunday);
        date.setDate(startSunday.getDate() + w * 7 + d);
        const cell = document.createElement("div");
        cell.className = "bon-cal-cell";
        if (date > today) {
          cell.classList.add("bon-cal-cell--future");
        } else {
          const c = counts.get(dayKey(date)) || 0;
          const lvl = bonBucketLevel(c);
          const inUnknownZone =
            earliestVisible && date.getTime() < earliestVisible && c === 0;
          if (inUnknownZone) {
            cell.classList.add("bon-cal-cell--unknown");
            cell.title = `${date.toLocaleDateString()} — beyond Reddit's API window (unknown)`;
          } else if (lvl > 0) {
            cell.classList.add(`bon-heatmap-cell--lvl${lvl}`);
            cell.title = `${date.toLocaleDateString()} — ${c} item${c === 1 ? "" : "s"}`;
          } else {
            cell.title = `${date.toLocaleDateString()} — no activity`;
          }
        }
        grid.appendChild(cell);
      }
    }
    right.appendChild(grid);

    wrap.appendChild(right);

    const legend = document.createElement("div");
    legend.className = "bon-heatmap-legend";
    legend.appendChild(document.createTextNode("Less"));
    for (let i = 0; i <= 5; i++) {
      const cell = document.createElement("span");
      cell.className = "bon-heatmap-legend-cell";
      if (i > 0) {
        cell.classList.add(`bon-heatmap-cell--lvl${i}`);
      }
      legend.appendChild(cell);
    }
    legend.appendChild(document.createTextNode("More"));

    const outer = document.createElement("div");
    outer.appendChild(wrap);
    outer.appendChild(legend);
    return outer;
  }

  function renderHourSection(timestamps, activityData) {
    const outer = document.createElement("div");
    outer.style.marginTop = "0.75em";

    // Surface every deterministic signal source independently so the operator
    // can see which ones fired (subreddit / script / language markers /
    // moderated subs) — not just the combined verdict.
    const subRegion = bonInferRegionFromSubreddits(
      activityData?.subredditCounts
    );
    const scriptRegion = bonInferRegionFromScripts(activityData?.scriptSignals);
    const langRegion = bonInferRegionFromLanguage(
      activityData?.languageSignals
    );
    const modRegion = bonInferRegionFromModerated(activityData?.moderatedSubs);

    if (subRegion) {
      const row = document.createElement("p");
      row.className = "bon-heatmap-row";
      row.appendChild(renderSubredditRegionLine(subRegion));
      outer.appendChild(row);
    }
    if (scriptRegion) {
      const row = document.createElement("p");
      row.className = "bon-heatmap-row";
      row.appendChild(renderScriptRegionLine(scriptRegion));
      outer.appendChild(row);
    }
    if (langRegion) {
      const row = document.createElement("p");
      row.className = "bon-heatmap-row";
      row.appendChild(renderLanguageRegionLine(langRegion));
      outer.appendChild(row);
    }
    if (modRegion) {
      const row = document.createElement("p");
      row.className = "bon-heatmap-row";
      row.appendChild(renderModeratorRegionLine(modRegion));
      outer.appendChild(row);
    }

    const inferred = inferTimezoneFromTimestamps(timestamps);
    const primary = document.createElement("p");
    primary.className = "bon-heatmap-row";
    primary.appendChild(renderInferredTimezone(inferred, subRegion));
    outer.appendChild(primary);

    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const advisory = document.createElement("p");
    advisory.className = "bon-heatmap-row bon-heatmap-advisory";
    advisory.innerHTML = `<small>Heatmap below uses your local timezone (<strong>${tzName}</strong>) for reference.</small>`;
    outer.appendChild(advisory);

    outer.appendChild(renderHourHeatmap(timestamps));
    return outer;
  }

  // Infer the profile user's timezone from when they post.
  // Humans have a daily sleep window; finding the 6-hour low in UTC posting
  // activity and assuming its midpoint is ~03:00 local gives a rough offset.
  function inferTimezoneFromTimestamps(timestamps) {
    if (!timestamps || timestamps.length < 20) {
      return { kind: "insufficient", count: timestamps?.length || 0 };
    }

    const utcCounts = new Array(24).fill(0);
    for (const t of timestamps) {
      utcCounts[new Date(t).getUTCHours()]++;
    }

    const WINDOW = 6;
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minStart = 0;
    for (let start = 0; start < 24; start++) {
      let sum = 0;
      for (let i = 0; i < WINDOW; i++) {
        sum += utcCounts[(start + i) % 24];
      }
      if (sum < minSum) {
        minSum = sum;
        minStart = start;
      }
      if (sum > maxSum) {
        maxSum = sum;
      }
    }

    const total = utcCounts.reduce((a, b) => a + b, 0);
    const ratio = maxSum > 0 ? minSum / maxSum : 1;
    // If the quietest 6h window holds more than half what the busiest does,
    // there's no clear sleep period — flag it (a documented bot signal).
    if (ratio > 0.5) {
      return { kind: "flat", ratio, total };
    }

    const sleepMidUtc = (minStart + WINDOW / 2) % 24;
    let offset = 3 - sleepMidUtc;
    if (offset > 12) {
      offset -= 24;
    }
    if (offset <= -12) {
      offset += 24;
    }
    const rounded = Math.round(offset);
    return {
      kind: "inferred",
      offsetHours: rounded,
      sleepStartUtc: minStart,
      sleepEndUtc: (minStart + WINDOW) % 24,
      total,
      confidence: 1 - ratio,
    };
  }

  function renderInferredTimezone(inferred, subRegion) {
    const span = document.createElement("span");
    if (inferred.kind === "insufficient") {
      span.innerHTML = `<small>Not enough activity to infer a timezone (${inferred.count} item${inferred.count === 1 ? "" : "s"}).</small>`;
      return span;
    }
    if (inferred.kind === "flat") {
      span.innerHTML = `⚠ <strong>No clear daily cycle</strong> — activity is spread evenly across 24 hours UTC. Possible bot, shared account, or multi-region operator.`;
      return span;
    }
    const { offsetHours, sleepStartUtc, sleepEndUtc } = inferred;
    const offsetStr = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
    const region = bonRegionForOffset(offsetHours);
    const sleep = `${bonPad2(sleepStartUtc)}:00–${bonPad2(sleepEndUtc)}:00 UTC`;
    let suffix = "";
    if (subRegion) {
      const info = BON_REGION_INFO[subRegion.region];
      const offsets = info?.utcOffsets || [];
      if (offsets.includes(offsetHours)) {
        suffix = ` — <strong style="color:#16a085">matches ${info.label} posting history ✓</strong>`;
      } else {
        suffix = ` — <strong style="color:#c0392b">does NOT match ${info?.label || subRegion.region} posting history ⚠</strong>`;
      }
    }
    span.innerHTML = `Likely profile timezone: <strong>${offsetStr}</strong>${region ? ` (${region})` : ""} — inactive window ${sleep}${suffix}`;
    return span;
  }

  function renderSubredditRegionLine(subRegion) {
    const info = BON_REGION_INFO[subRegion.region] || {
      flag: "🏳",
      label: subRegion.region,
    };
    const span = document.createElement("span");
    const hitsList = subRegion.hits
      .slice(0, 5)
      .map(({ sub, count }) => `r/${sub}${count > 1 ? ` ×${count}` : ""}`)
      .join(", ");
    const moreNote =
      subRegion.hits.length > 5
        ? ` <span class="bon-region-tz">+${subRegion.hits.length - 5} more</span>`
        : "";
    let runnerNote = "";
    if (subRegion.runnerUp) {
      const r = BON_REGION_INFO[subRegion.runnerUp.region];
      runnerNote = ` <span class="bon-region-tz">(also ${subRegion.runnerUp.count} in ${r?.label || subRegion.runnerUp.region})</span>`;
    }
    span.innerHTML = `Region from posting history: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${subRegion.count} item${subRegion.count === 1 ? "" : "s"} in ${hitsList}${moreNote}${runnerNote}`;
    return span;
  }

  function renderScriptRegionLine(scriptRegion) {
    const info = BON_REGION_INFO[scriptRegion.region] || {
      flag: "🏳",
      label: scriptRegion.region,
    };
    const span = document.createElement("span");
    const hits = scriptRegion.hits
      .map((h) => `${h.count} ${h.script}`)
      .join(", ");
    span.innerHTML = `Script in their writing: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${hits}`;
    return span;
  }

  function renderLanguageRegionLine(langRegion) {
    const info = BON_REGION_INFO[langRegion.region] || {
      flag: "🏳",
      label: langRegion.region,
    };
    const span = document.createElement("span");
    const hits = langRegion.hits.map((h) => `${h.count} ${h.label}`).join(", ");
    span.innerHTML = `Language markers in writing: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${hits}`;
    return span;
  }

  function renderModeratorRegionLine(modRegion) {
    const info = BON_REGION_INFO[modRegion.region] || {
      flag: "🏳",
      label: modRegion.region,
    };
    const span = document.createElement("span");
    const list = modRegion.hits
      .slice(0, 5)
      .map((h) => `r/${h.sub}`)
      .join(", ");
    const more =
      modRegion.hits.length > 5
        ? ` <span class="bon-region-tz">+${modRegion.hits.length - 5} more</span>`
        : "";
    span.innerHTML = `Moderates ${modRegion.score} ${info.label}-coded sub${modRegion.score === 1 ? "" : "s"}: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${list}${more}`;
    return span;
  }

  function renderHourHeatmap(timestamps) {
    // 7 (day of week) x 24 (hour of day) buckets in the viewer's local timezone.
    const counts = new Array(7 * 24).fill(0);
    for (const t of timestamps) {
      const local = new Date(t);
      const dow = local.getDay();
      const hour = local.getHours();
      counts[dow * 24 + hour]++;
    }

    const wrap = document.createElement("div");
    wrap.className = "bon-hour";

    const dayLabels = document.createElement("div");
    dayLabels.className = "bon-hour-days";
    for (let i = 0; i < 7; i++) {
      const d = document.createElement("div");
      d.textContent = DAY_NAMES[i];
      dayLabels.appendChild(d);
    }
    wrap.appendChild(dayLabels);

    const right = document.createElement("div");
    right.className = "bon-hour-right";

    const hourLabels = document.createElement("div");
    hourLabels.className = "bon-hour-hours";
    for (let h = 0; h < 24; h++) {
      const s = document.createElement("span");
      s.textContent = h % 6 === 0 ? String(h) : "";
      hourLabels.appendChild(s);
    }
    right.appendChild(hourLabels);

    const grid = document.createElement("div");
    grid.className = "bon-hour-grid";
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const cell = document.createElement("div");
        cell.className = "bon-hour-cell";
        const c = counts[d * 24 + h];
        const lvl = bonBucketLevel(c);
        if (lvl > 0) {
          cell.classList.add(`bon-heatmap-cell--lvl${lvl}`);
        }
        cell.title = `${DAY_NAMES[d]} ${String(h).padStart(2, "0")}:00 — ${c} item${c === 1 ? "" : "s"}`;
        grid.appendChild(cell);
      }
    }
    right.appendChild(grid);
    wrap.appendChild(right);
    return wrap;
  }
})();
