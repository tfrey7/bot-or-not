(async function () {
  const heading = document.getElementById("bon-reports-heading");
  const list = document.getElementById("bon-reports-list");
  const clearBtn = document.getElementById("bon-clear-btn");
  const modal = document.getElementById("bon-confirm-modal");
  const cancelBtn = document.getElementById("bon-cancel-clear");
  const confirmBtn = document.getElementById("bon-confirm-clear");

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
    if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
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

  try {
    const { reports = {} } = await browser.runtime.sendMessage({
      type: "get-all-reports",
    });

    const entries = Object.entries(reports).sort((a, b) => {
      const dateDiff = (b[1].lastReportedAt || 0) - (a[1].lastReportedAt || 0);
      if (dateDiff !== 0) return dateDiff;
      return b[1].count - a[1].count;
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
      list.appendChild(renderReportRow(username, report));
    }
  } catch (err) {
    console.error("[Bot or Not] failed to load reports", err);
    heading.textContent = "Reported users";
    const errEl = document.createElement("p");
    errEl.className = "bon-empty";
    errEl.textContent = "Failed to load reports.";
    list.replaceWith(errEl);
  }

  function renderReportRow(username, report) {
    const { count, lastReportedAt, history, userStatus } = report;
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

    const userIcon = statusIcon(userStatus, "user");
    if (userIcon) nameCell.appendChild(userIcon);

    const dateEl = document.createElement("span");
    dateEl.className = "bon-report-date";
    if (lastReportedAt) {
      dateEl.textContent = formatDate(lastReportedAt);
      dateEl.title = new Date(lastReportedAt).toLocaleString();
    }

    const countEl = document.createElement("span");
    countEl.className = "bon-report-count";
    countEl.textContent = `(${count}x)`;

    summary.appendChild(nameCell);
    summary.appendChild(dateEl);
    summary.appendChild(countEl);

    const hasHistory = history && history.length > 0;
    const chevronSlot = document.createElement("span");

    if (hasHistory) {
      const expandBtn = document.createElement("button");
      expandBtn.className = "bon-expand-btn";
      expandBtn.setAttribute("aria-expanded", "false");
      expandBtn.setAttribute("aria-label", "Show report history");
      expandBtn.textContent = "▶";

      const historyEl = renderHistory(history);
      historyEl.hidden = true;

      expandBtn.addEventListener("click", () => {
        const expanded = expandBtn.getAttribute("aria-expanded") === "true";
        expandBtn.setAttribute("aria-expanded", String(!expanded));
        historyEl.hidden = expanded;
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
    } else {
      time.textContent = "unknown date";
    }
    li.appendChild(time);

    const meta = document.createElement("span");
    meta.className = "bon-report-history-meta";

    const targetUrl = resolveUrl(entry.permalink) || entry.sourceUrl;
    const labelParts = [];
    if (entry.kind) labelParts.push(entry.kind);
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
      meta.textContent = label;
      meta.title = label;
    }

    const postIcon = statusIcon(entry.status, "post");
    if (postIcon) meta.appendChild(postIcon);

    li.appendChild(meta);

    return li;
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
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString(undefined, {
      year: sameYear ? undefined : "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
})();
