(async function () {
  const heading = document.getElementById("bon-reports-heading");
  const list = document.getElementById("bon-reports-list");
  const clearBtn = document.getElementById("bon-clear-btn");
  const openFullBtn = document.getElementById("bon-open-full-btn");
  const modal = document.getElementById("bon-confirm-modal");
  const cancelBtn = document.getElementById("bon-cancel-clear");
  const confirmBtn = document.getElementById("bon-confirm-clear");
  const settingsBtn = document.getElementById("bon-settings-btn");
  const settingsModal = document.getElementById("bon-settings-modal");
  const settingsCancel = document.getElementById("bon-settings-cancel");
  const settingsSave = document.getElementById("bon-settings-save");
  const apiKeyInput = document.getElementById("bon-api-key-input");
  const apiKeyStatus = document.getElementById("bon-api-key-status");

  const rowsByUsername = new Map();
  const expandedDetails = new Set();

  openFullBtn.addEventListener("click", async () => {
    await browser.tabs.create({
      url: browser.runtime.getURL("src/reports.html"),
    });
    window.close();
  });

  clearBtn.addEventListener("click", () => {
    modal.hidden = false;
    cancelBtn.focus();
  });
  cancelBtn.addEventListener("click", () => {
    modal.hidden = true;
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal.hidden) modal.hidden = true;
    if (!settingsModal.hidden) settingsModal.hidden = true;
  });
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await browser.runtime.sendMessage({ type: "clear-all-reports" });
      window.location.reload();
    } catch (err) {
      console.error("[Bot or Not] failed to clear reports", err);
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  settingsBtn.addEventListener("click", openSettings);
  settingsCancel.addEventListener("click", () => {
    settingsModal.hidden = true;
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) settingsModal.hidden = true;
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

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.reports) return;
    const newReports = changes.reports.newValue || {};
    for (const [username, report] of Object.entries(newReports)) {
      if (rowsByUsername.has(username)) {
        replaceRow(username, report);
      }
    }
  });

  function replaceRow(username, report) {
    const existing = rowsByUsername.get(username);
    if (!existing) return;
    const fresh = renderReportRow(username, report);
    existing.replaceWith(fresh);
    rowsByUsername.set(username, fresh);
  }

  let response;
  try {
    response = await browser.runtime.sendMessage({ type: "get-all-reports" });
  } catch (err) {
    console.error("[Bot or Not] sendMessage(get-all-reports) failed", err);
    showLoadError(`Failed to load reports: ${err?.message || err}`);
    return;
  }

  const reports = response?.reports || {};
  const entries = Object.entries(reports).sort((a, b) => {
    const dateDiff = (b[1].lastReportedAt || 0) - (a[1].lastReportedAt || 0);
    if (dateDiff !== 0) return dateDiff;
    return (b[1].count || 0) - (a[1].count || 0);
  });

  heading.textContent = `Reported users (${entries.length})`;

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-empty";
    empty.textContent = "No reports yet.";
    list.replaceWith(empty);
    return;
  }

  clearBtn.hidden = false;

  for (const [username, report] of entries) {
    try {
      const row = renderReportRow(username, report);
      rowsByUsername.set(username, row);
      list.appendChild(row);
    } catch (err) {
      console.error("[Bot or Not] failed to render row", username, report, err);
      list.appendChild(renderErrorRow(username, err));
    }
  }

  function showLoadError(text) {
    heading.textContent = "Reported users";
    const errEl = document.createElement("p");
    errEl.className = "bon-empty";
    errEl.textContent = text;
    list.replaceWith(errEl);
  }

  function renderErrorRow(username, err) {
    const li = document.createElement("li");
    li.className = "bon-empty";
    li.textContent = `u/${username}: render failed — ${err?.message || err}`;
    return li;
  }

  function renderReportRow(username, report) {
    const { lastReportedAt, history, investigation } = report;
    const li = document.createElement("li");

    const summary = document.createElement("div");
    summary.className = "bon-report-summary";

    const nameCell = document.createElement("span");
    nameCell.className = "bon-username-cell";

    const link = document.createElement("a");
    link.href = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `u/${username}`;
    nameCell.appendChild(link);

    const verdictEl = verdictBadge(investigation);
    if (verdictEl) nameCell.appendChild(verdictEl);

    const dateEl = document.createElement("span");
    dateEl.className = "bon-report-date";
    if (lastReportedAt) {
      dateEl.textContent = formatDate(lastReportedAt);
      dateEl.title = new Date(lastReportedAt).toLocaleString();
    }

    const investigateBtn = renderInvestigateButton(username, investigation);
    const checkBtn = renderCheckButton(username);

    summary.appendChild(nameCell);
    summary.appendChild(dateEl);
    summary.appendChild(investigateBtn);
    summary.appendChild(checkBtn);

    const hasHistory = history && history.length > 0;
    const chevronSlot = document.createElement("span");

    if (hasHistory) {
      const historyEl = renderHistory(history);
      const startExpanded = expandedDetails.has(username);
      historyEl.hidden = !startExpanded;

      const expandBtn = document.createElement("button");
      expandBtn.className = "bon-expand-btn";
      expandBtn.setAttribute("aria-expanded", String(startExpanded));
      expandBtn.setAttribute("aria-label", "Show report history");
      expandBtn.textContent = "▶";

      expandBtn.addEventListener("click", () => {
        const expanded = expandBtn.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        expandBtn.setAttribute("aria-expanded", String(next));
        historyEl.hidden = !next;
        if (next) expandedDetails.add(username);
        else expandedDetails.delete(username);
      });

      chevronSlot.appendChild(expandBtn);
      summary.appendChild(chevronSlot);
      li.appendChild(summary);
      li.appendChild(historyEl);
    } else {
      summary.appendChild(chevronSlot);
      li.appendChild(summary);
    }

    return li;
  }

  function renderCheckButton(username) {
    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "bon-check-btn";
    checkBtn.title = `Check external sources for ${username}`;
    checkBtn.setAttribute(
      "aria-label",
      `Check external sources for ${username}`
    );
    checkBtn.textContent = "🔍";
    checkBtn.addEventListener("click", () => {
      browser.runtime.sendMessage({
        type: "open-tabs",
        urls: [
          `https://www.reddit.com/r/BotBouncer/search/?q=${encodeURIComponent(username)}&restrict_sr=true`,
          `https://redditmetis.com/user/${encodeURIComponent(username)}`,
          `https://profileprobe.com/botornot/?u=${encodeURIComponent(username)}`,
          `https://www.google.com/search?q=${encodeURIComponent(`reddit "${username}"`)}`,
        ],
      });
    });
    return checkBtn;
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
    btn.addEventListener("click", () => triggerInvestigation(username, btn));
    return btn;
  }

  async function triggerInvestigation(username, btn) {
    btn.disabled = true;
    btn.classList.add("bon-spinning");
    btn.textContent = "";
    try {
      const res = await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      });
      if (res?.ok === false && res.error === "no-api-key") {
        btn.classList.remove("bon-spinning");
        btn.disabled = false;
        btn.textContent = "🤖";
        openSettings();
      }
      // The storage.onChanged listener will re-render the row with the final result.
    } catch (err) {
      console.error("[Bot or Not] investigate failed", err);
      btn.classList.remove("bon-spinning");
      btn.disabled = false;
      btn.textContent = "🤖";
    }
  }

  function verdictBadge(rawInvestigation) {
    if (!rawInvestigation) return null;
    if (rawInvestigation.status === "running") return null;
    if (rawInvestigation.status === "error") {
      const span = document.createElement("span");
      span.className = "bon-verdict-badge bon-verdict-badge--error";
      span.textContent = "error";
      span.title = rawInvestigation.error || "Investigation failed";
      return span;
    }
    const investigation = bonNormalizeInvestigation(rawInvestigation);
    if (!investigation.verdict) return null;

    const span = document.createElement("span");
    span.className = "bon-verdict-badge";
    span.textContent = investigation.verdict.replace(/-/g, " ");

    const confidence =
      typeof investigation.confidence === "number"
        ? Math.max(0, Math.min(1, investigation.confidence))
        : 0.5;
    span.style.background = verdictColor(investigation.verdict, confidence);

    const confPct = Math.round(confidence * 100);
    const summaryText = investigation.summary || "";
    span.title = summaryText
      ? `${summaryText} · ${confPct}% confidence`
      : `${confPct}% confidence`;
    return span;
  }

  // Red for bot, green for human, amber for uncertain.
  // Lightness scales with confidence: bolder = more confident.
  function verdictColor(verdict, confidence) {
    const isBot = verdict === "bot" || verdict === "likely-bot";
    const isHuman = verdict === "human" || verdict === "likely-human";
    if (!isBot && !isHuman) return `hsl(36, 60%, 45%)`; // amber for uncertain
    const hue = isBot ? 6 : 145;
    const lightness = 60 - confidence * 25; // 60% (faded) → 35% (saturated)
    const saturation = 40 + confidence * 40; // 40% → 80%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  function renderHistory(history) {
    const ul = document.createElement("ul");
    ul.className = "bon-report-history";

    const sorted = [...history].sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const entry of sorted) {
      ul.appendChild(renderHistoryEntry(entry));
    }
    return ul;
  }

  function renderHistoryEntry(entry) {
    const li = document.createElement("li");

    const time = document.createElement("time");
    if (entry.at) {
      time.dateTime = new Date(entry.at).toISOString();
      time.textContent = formatDate(entry.at);
      time.title = new Date(entry.at).toLocaleString();
    } else {
      time.textContent = "unknown date";
    }
    li.appendChild(time);

    const meta = document.createElement("span");
    meta.className = "bon-report-history-meta";

    const leadIcon = statusIcon(entry.status) || kindIconFor(entry.kind);
    if (leadIcon) meta.appendChild(leadIcon);

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
      meta.appendChild(a);
    } else {
      const textEl = document.createElement("span");
      textEl.textContent = label;
      textEl.title = label;
      meta.appendChild(textEl);
    }

    li.appendChild(meta);

    return li;
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

  function statusIcon(status) {
    if (!status) return null;
    const span = document.createElement("span");
    span.className = `bon-status-icon bon-status-icon--${status}`;
    if (status === "removed") {
      span.textContent = "🚫";
      span.title = "Removed by moderators";
    } else if (status === "deleted") {
      span.textContent = "❌";
      span.title = "Deleted by user";
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

  function formatDate(ts) {
    const d = new Date(ts);
    const diffMs = Date.now() - ts;
    const min = 60_000;
    const hour = 60 * min;
    const day = 24 * hour;
    if (diffMs < min) return "now";
    if (diffMs < hour) return `${Math.floor(diffMs / min)}m`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d`;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, {
      year: sameYear ? undefined : "2-digit",
      month: "short",
      day: "numeric",
    });
  }
})();
