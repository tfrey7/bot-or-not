(async function () {
  const tbody = document.getElementById("bon-tbody");
  const tableWrap = document.getElementById("bon-table-wrap");
  const emptyEl = document.getElementById("bon-empty");
  const searchInput = document.getElementById("bon-search");
  const clearBtn = document.getElementById("bon-clear-btn");
  const refreshBtn = document.getElementById("bon-refresh-btn");
  const modal = document.getElementById("bon-confirm-modal");
  const modalText = document.getElementById("bon-modal-text");
  const cancelBtn = document.getElementById("bon-cancel-clear");
  const confirmBtn = document.getElementById("bon-confirm-clear");
  let pendingConfirmAction = null;

  let allReports = [];
  let sortKey = "lastReportedAt";
  let sortDir = "desc";
  const expanded = new Set();
  const inflightActivity = new Set();
  const BON_ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

  // --- Triangle helpers (beta) ---
  // Placeholder so the widget has something to render before the real parallel
  // analysis ships. Stable per-username so positions don't jitter between renders.
  function bonPlaceholderTriangle(username) {
    let h = 2166136261;
    for (let i = 0; i < username.length; i++) {
      h = (h ^ username.charCodeAt(i)) >>> 0;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    const a = (h % 1000) / 1000;
    const b = ((h >>> 10) % 1000) / 1000;
    const c = ((h >>> 20) % 1000) / 1000;
    const sum = a + b + c || 1;
    return { bot: a / sum, stan: b / sum, farmer: c / sum };
  }

  function triangleFor(report) {
    return (
      report.investigation?.triangle || bonPlaceholderTriangle(report.username)
    );
  }

  // "Normal" when no single corner pulls the position meaningfully off the
  // centroid. 0.20 is a tilt of 20 percentage points between max and min.
  function dominantCorner(tri) {
    const max = Math.max(tri.bot, tri.stan, tri.farmer);
    const min = Math.min(tri.bot, tri.stan, tri.farmer);
    if (max - min < 0.2) return { key: "normal", label: "Normal" };
    if (max === tri.bot) return { key: "bot", label: "Bot" };
    if (max === tri.stan) return { key: "stan", label: "Stan" };
    return { key: "farmer", label: "Farmer" };
  }

  function isActivityFresh(activityData) {
    return (
      !!activityData?.fetchedAt &&
      Date.now() - activityData.fetchedAt < BON_ACTIVITY_TTL_MS
    );
  }

  async function loadActivityIfStale(username, activityData) {
    if (isActivityFresh(activityData)) return;
    if (inflightActivity.has(username)) return;
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

  // Source of truth for *currently active* factors. Stored investigations may
  // contain factor keys not in this list (deprecated since the report ran) —
  // those are dropped silently. Keys in this list missing from a stored
  // investigation are rendered as "added after" placeholders so old reports
  // stay readable without re-running.
  // Factor list is canonical in src/factors.js.
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
    if (area === "local" && changes.reports) load();
  });

  refreshBtn.addEventListener("click", load);
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
    if (e.target === modal) closeConfirmModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeConfirmModal();
  });
  confirmBtn.addEventListener("click", async () => {
    if (!pendingConfirmAction) return;
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
    } catch (err) {
      console.error("[Bot or Not] failed to load reports", err);
      tableWrap.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = "Failed to load reports.";
    }
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();

    const filtered = allReports.filter((r) => {
      if (!query) return true;
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
      for (const row of detailRows) tbody.appendChild(row);
    }

    ensurePolling();
  }

  function sanitizeUsernameQuery(raw) {
    const trimmed = (raw || "").trim().replace(/^\/?u\//i, "");
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(trimmed)) return null;
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

    if (!query) return;
    const username = sanitizeUsernameQuery(query);
    if (!username) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-btn bon-empty-action";
    btn.textContent = `Report u/${username}`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Reporting…";
      try {
        await browser.runtime.sendMessage({
          type: "report-user",
          username,
        });
        // storage.onChanged will reload and re-render.
      } catch (err) {
        console.error("[Bot or Not] manual report failed", err);
        btn.disabled = false;
        btn.textContent = `Report u/${username}`;
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
      } else {
        updateRunningInPlace();
        ensurePolling();
      }
    } catch (err) {
      console.error("[Bot or Not] poll tick failed", err);
    }
  }

  function hasStructuralChange(prev, next) {
    if (prev.length !== next.length) return true;
    const prevByUser = new Map(prev.map((r) => [r.username, r]));
    for (const r of next) {
      const p = prevByUser.get(r.username);
      if (!p) return true;
      const ps = p.investigation?.status;
      const ns = r.investigation?.status;
      if (ps !== ns) return true;
      if (p.investigation?.verdict !== r.investigation?.verdict) return true;
      if (p.count !== r.count) return true;
      if (p.lastReportedAt !== r.lastReportedAt) return true;
      const pStale =
        ps === "running" && bonIsInvestigationStale(p.investigation);
      const nStale =
        ns === "running" && bonIsInvestigationStale(r.investigation);
      if (pStale !== nStale) return true;
    }
    return false;
  }

  function updateRunningInPlace() {
    for (const r of allReports) {
      const inv = r.investigation;
      if (inv?.status !== "running") continue;
      if (bonIsInvestigationStale(inv)) continue;
      if (!inv.startedAt) continue;
      const elapsed = Math.max(
        0,
        Math.round((Date.now() - inv.startedAt) / 1000)
      );
      const cells = tbody.querySelectorAll("[data-bon-running-cell]");
      for (const cell of cells) {
        if (cell.dataset.bonRunningCell === r.username) {
          cell.textContent = `Running… ${elapsed}s`;
        }
      }
      const btns = tbody.querySelectorAll("[data-bon-running-btn]");
      for (const btn of btns) {
        if (btn.dataset.bonRunningBtn === r.username) {
          btn.title = `Investigation running… ${elapsed}s elapsed (large accounts can take 60–90s)`;
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
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      const aTime = a.lastReportedAt || 0;
      const bTime = b.lastReportedAt || 0;
      return bTime - aTime;
    };
  }

  function sortValue(r, key) {
    if (key === "username") return r.username.toLowerCase();
    if (key === "count") return r.count || 0;
    if (key === "lastReportedAt") return r.lastReportedAt || 0;
    if (key === "triangle") {
      // Sort by how far the dot is pulled toward any corner — most extreme first.
      const t = triangleFor(r);
      return Math.max(t.bot, t.stan, t.farmer);
    }
    if (key === "investigatedAt") return r.investigation?.runAt || 0;
    return null;
  }

  function renderReportRow(report) {
    const { username, lastReportedAt, history, count, investigation } = report;

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
        for (const row of detailRows) row.hidden = !next;
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

    const triangleCell = document.createElement("td");
    triangleCell.className = "bon-triangle-cell";
    const tri = triangleFor(report);
    const widget = bonRenderTriangleWidget(tri);
    if (widget) triangleCell.appendChild(widget);
    const dom = dominantCorner(tri);
    const domLabel = document.createElement("div");
    domLabel.className = `bon-triangle-dominant bon-triangle-dominant--${dom.key}`;
    domLabel.textContent = dom.label;
    triangleCell.appendChild(domLabel);
    summary.appendChild(triangleCell);

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

    const countCell = document.createElement("td");
    countCell.className = "bon-cell-numeric";
    countCell.textContent = count || 0;
    summary.appendChild(countCell);

    const dateCell = document.createElement("td");
    dateCell.className = "bon-cell-muted";
    if (lastReportedAt) {
      dateCell.textContent = formatDate(lastReportedAt);
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

    // Triangle breakdown is always available (real data when present, otherwise
    // the placeholder), so we always render this detail row first.
    const triangleRow = document.createElement("tr");
    triangleRow.className = "bon-row-history";
    triangleRow.hidden = startCollapsed;
    const triangleDetailCell = document.createElement("td");
    triangleDetailCell.colSpan = 8;
    triangleDetailCell.appendChild(renderTriangleDetail(tri));
    triangleRow.appendChild(triangleDetailCell);
    detailRows.push(triangleRow);

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
    if (leadIcon) kindCell.appendChild(leadIcon);
    tr.appendChild(kindCell);

    const labelCell = document.createElement("td");
    const targetUrl = resolveUrl(entry.permalink) || entry.sourceUrl;
    const labelParts = [];
    if (entry.subreddit) labelParts.push(entry.subreddit);
    if (entry.postTitle) labelParts.push(entry.postTitle);
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
    if (!rawInvestigation) return null;
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
    if (!investigation.verdict) return null;
    const span = document.createElement("span");
    span.className = `bon-verdict-badge bon-verdict-badge--${investigation.verdict}`;
    span.textContent = formatVerdict(investigation.verdict);
    span.title = investigation.summary || investigation.verdict;
    return span;
  }

  function renderFactorDots(investigation) {
    const wrap = document.createElement("span");
    wrap.className = "bon-factors-cell";
    const factorsByKey = new Map();
    if (Array.isArray(investigation?.factors)) {
      for (const f of investigation.factors) {
        if (f?.key) factorsByKey.set(f.key, f);
      }
    }
    // Treat "missing" specially only when the investigation actually ran (status
    // done). A never-run investigation gets the plain "missing" gray dots
    // without the "added after" framing.
    const hasRun = investigation?.status === "done";
    for (const key of FACTOR_KEYS) {
      const dot = document.createElement("span");
      const f = factorsByKey.get(key);
      const label = FACTOR_LABELS[key] || key;
      if (!f && hasRun) {
        dot.className = "bon-factor-dot bon-factor-dot--new";
        dot.title = `${label}: added after this investigation ran — re-run to score`;
      } else if (!f) {
        dot.className = "bon-factor-dot bon-factor-dot--missing";
        dot.title = `${label}: not investigated`;
      } else {
        const leaning = scoreLeaning(f.score, f.confidence);
        dot.className = `bon-factor-dot bon-factor-dot--${leaning}`;
        const scoreText =
          typeof f.score === "number" ? f.score.toFixed(2) : "—";
        const confText =
          typeof f.confidence === "number"
            ? `${Math.round(f.confidence * 100)}%`
            : "—";
        dot.title = `${label}: score ${scoreText}, confidence ${confText}`;
      }
      wrap.appendChild(dot);
    }
    return wrap;
  }

  function scoreLeaning(score, confidence) {
    if (typeof score !== "number") return "neutral";
    if (typeof confidence === "number" && confidence < 0.2) return "neutral";
    if (score <= -0.5) return "bot";
    if (score <= -0.2) return "likely-bot";
    if (score >= 0.5) return "human";
    if (score >= 0.2) return "likely-human";
    return "neutral";
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
        cell.textContent = `Running… ${elapsed}s`;
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
      ? formatDate(investigation.runAt)
      : "—";
    if (investigation.runAt) {
      when.title = new Date(investigation.runAt).toLocaleString();
    }
    cell.appendChild(when);
    if (typeof investigation.durationMs === "number") {
      const dur = document.createElement("span");
      dur.className = "bon-duration";
      dur.textContent = `Took ${formatDuration(investigation.durationMs)}`;
      cell.appendChild(dur);
    }
  }

  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return rem ? `${m}m ${rem}s` : `${m}m`;
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
      const elapsed = Math.max(
        0,
        Math.round(
          (Date.now() - (investigation.startedAt || Date.now())) / 1000
        )
      );
      btn.title = `Investigation running… ${elapsed}s elapsed (large accounts can take 60–90s)`;
      btn.disabled = true;
      btn.classList.add("bon-spinning");
      btn.dataset.bonRunningBtn = username;
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
          alert(
            "No Claude API key set. Open the main Reports page and click Settings to add one."
          );
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

  function renderTriangleDetail(tri) {
    const wrap = document.createElement("div");
    wrap.className = "bon-detail-triangle-wrap";

    const widget = bonRenderTriangleWidget(tri);
    if (widget) {
      // Scale up the in-row widget for the detail view without re-implementing it.
      widget.style.transform = "scale(1.8)";
      widget.style.transformOrigin = "left center";
      widget.style.marginRight = "5em";
      widget.style.marginLeft = "2em";
      wrap.appendChild(widget);
    }

    const bars = document.createElement("div");
    bars.className = "bon-detail-triangle-bars";
    const corners = [
      { key: "bot", label: "Bot" },
      { key: "stan", label: "Stan" },
      { key: "farmer", label: "Farmer" },
    ];
    for (const c of corners) {
      const row = document.createElement("div");
      row.className = "bon-detail-triangle-bar-row";
      const label = document.createElement("span");
      label.className = "bon-detail-triangle-bar-label";
      label.textContent = c.label;
      const track = document.createElement("div");
      track.className = "bon-detail-triangle-bar-track";
      const fill = document.createElement("div");
      fill.className = `bon-detail-triangle-bar-fill bon-detail-triangle-bar-fill--${c.key}`;
      fill.style.width = `${Math.round(tri[c.key] * 100)}%`;
      track.appendChild(fill);
      const value = document.createElement("span");
      value.className = "bon-detail-triangle-bar-value";
      value.textContent = `${Math.round(tri[c.key] * 100)}%`;
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      bars.appendChild(row);
    }
    wrap.appendChild(bars);

    return wrap;
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

    if (investigation.summary) {
      const summary = document.createElement("p");
      summary.className = "bon-verdict-summary";
      summary.textContent = investigation.summary;
      wrap.appendChild(summary);
    }

    const meta = document.createElement("p");
    meta.className = "bon-verdict-meta";
    const metaParts = [];
    if (typeof investigation.confidence === "number") {
      metaParts.push(
        `overall confidence ${Math.round(investigation.confidence * 100)}%`
      );
    }
    if (investigation.model) metaParts.push(investigation.model);
    if (investigation.runAt) {
      const ts = new Date(investigation.runAt).toLocaleString();
      metaParts.push(`run ${ts}`);
    }
    if (typeof investigation.durationMs === "number") {
      metaParts.push(`took ${formatDuration(investigation.durationMs)}`);
    }
    if (typeof investigation.postsFetched === "number") {
      metaParts.push(
        `${investigation.postsFetched} posts, ${investigation.commentsFetched ?? 0} comments analyzed`
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
    if (f.key && FACTOR_LABELS[f.key]) return FACTOR_LABELS[f.key];
    if (f.name) return f.name.replace(/_/g, " ");
    return f.key || "Factor";
  }

  function formatVerdict(verdict) {
    if (!verdict) return "";
    const spaced = verdict.replace(/-/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
      const leaning = scoreLeaning(f.score, f.confidence);
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
          : formatVerdict(leaning);
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
    const leaning = scoreLeaning(clamped, confidence);
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
    if (!kind) return null;
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
    if (!status) return null;
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
    if (!permalink) return null;
    if (/^https?:\/\//i.test(permalink)) return permalink;
    if (permalink.startsWith("/")) return `https://www.reddit.com${permalink}`;
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
    if (banner) wrap.appendChild(banner);

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
    wrap.appendChild(renderHourSection(timestamps));

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
    if (!postsLimited && !commentsLimited) return null;

    const earliestVisible = computeEarliestFullyVisible(activityData);
    const div = document.createElement("div");
    div.className = "bon-heatmap-banner";
    const limitedKinds = [];
    if (postsLimited) limitedKinds.push("posts");
    if (commentsLimited) limitedKinds.push("comments");
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
    if (postsLimited && earliestPostAt) bounds.push(earliestPostAt);
    if (commentsLimited && earliestCommentAt) bounds.push(earliestCommentAt);
    if (bounds.length === 0) return null;
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
          const lvl = bucketLevel(c);
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
      if (i > 0) cell.classList.add(`bon-heatmap-cell--lvl${i}`);
      legend.appendChild(cell);
    }
    legend.appendChild(document.createTextNode("More"));

    const outer = document.createElement("div");
    outer.appendChild(wrap);
    outer.appendChild(legend);
    return outer;
  }

  function renderHourSection(timestamps) {
    const outer = document.createElement("div");
    outer.style.marginTop = "0.75em";

    const inferred = inferTimezoneFromTimestamps(timestamps);
    const primary = document.createElement("p");
    primary.className = "bon-heatmap-row";
    primary.appendChild(renderInferredTimezone(inferred));
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
    for (const t of timestamps) utcCounts[new Date(t).getUTCHours()]++;

    const WINDOW = 6;
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minStart = 0;
    for (let start = 0; start < 24; start++) {
      let sum = 0;
      for (let i = 0; i < WINDOW; i++) sum += utcCounts[(start + i) % 24];
      if (sum < minSum) {
        minSum = sum;
        minStart = start;
      }
      if (sum > maxSum) maxSum = sum;
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
    if (offset > 12) offset -= 24;
    if (offset <= -12) offset += 24;
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

  function renderInferredTimezone(inferred) {
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
    const region = regionForOffset(offsetHours);
    const sleep = `${pad2(sleepStartUtc)}:00–${pad2(sleepEndUtc)}:00 UTC`;
    span.innerHTML = `Likely profile timezone: <strong>${offsetStr}</strong>${region ? ` (${region})` : ""} — inactive window ${sleep}`;
    return span;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function regionForOffset(offset) {
    if (offset === 0) return "UK, Portugal, West Africa";
    if (offset === 1) return "Western/Central Europe";
    if (offset === 2) return "Eastern Europe, South Africa";
    if (offset === 3) return "Moscow, Eastern Europe, East Africa";
    if (offset === 4) return "Gulf, Caucasus";
    if (offset === 5) return "Pakistan, West Asia";
    if (offset === 6) return "India, Bangladesh";
    if (offset === 7) return "Thailand, Vietnam, Indonesia";
    if (offset === 8) return "China, Singapore, Philippines";
    if (offset === 9) return "Japan, Korea";
    if (offset === 10) return "Eastern Australia";
    if (offset === 11) return "Solomon Islands";
    if (offset === 12) return "New Zealand";
    if (offset === -1) return "Azores, Cape Verde";
    if (offset === -2) return "Mid-Atlantic";
    if (offset === -3) return "Brazil, Argentina";
    if (offset === -4) return "Atlantic, Eastern Caribbean";
    if (offset === -5) return "US Eastern, Colombia, Peru";
    if (offset === -6) return "US Central, Mexico";
    if (offset === -7) return "US Mountain";
    if (offset === -8) return "US Pacific";
    if (offset === -9) return "Alaska";
    if (offset === -10) return "Hawaii";
    return "";
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
        const lvl = bucketLevel(c);
        if (lvl > 0) cell.classList.add(`bon-heatmap-cell--lvl${lvl}`);
        cell.title = `${DAY_NAMES[d]} ${String(h).padStart(2, "0")}:00 — ${c} item${c === 1 ? "" : "s"}`;
        grid.appendChild(cell);
      }
    }
    right.appendChild(grid);
    wrap.appendChild(right);
    return wrap;
  }

  function bucketLevel(count) {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    if (count <= 6) return 3;
    if (count <= 10) return 4;
    return 5;
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const diffMs = Date.now() - ts;
    const min = 60_000;
    const hour = 60 * min;
    const day = 24 * hour;
    if (diffMs < min) return "now";
    if (diffMs < hour) return `${Math.floor(diffMs / min)}m ago`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, {
      year: sameYear ? undefined : "2-digit",
      month: "short",
      day: "numeric",
    });
  }
})();
