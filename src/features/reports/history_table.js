// "Report history" sub-table rendered when a row is expanded — every
// previous time the user flagged this account, oldest at the bottom, with
// status/kind icons and a deep-link to the original target.

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
  const leadIcon = statusIcon(entry.status, "post") || kindIconFor(entry.kind);
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

export function bonReportsHistoryTable(history) {
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
