// List for the Reported tab — one row per report click, with the post
// title, an attribution line (user · subreddit · kind · when), and a
// takedown stamp.

import type { HistoryEntry } from "../../types.ts";
import { formatDate } from "../../utils/format_time.ts";
import type { ReportedPostRow } from "./logic.ts";

export function reportedPostsList(
  rows: ReportedPostRow[],
  onSelectUser: (username: string) => void
): HTMLElement {
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-reported-empty";
    empty.textContent = "Nothing here.";
    return empty;
  }

  const list = document.createElement("ul");
  list.className = "bon-reported-list";

  for (const row of rows) {
    list.appendChild(buildItem(row, onSelectUser));
  }

  return list;
}

function buildItem(
  row: ReportedPostRow,
  onSelectUser: (username: string) => void
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-reported-item";

  li.appendChild(buildItemTitle(row.entry));

  const metaLine = document.createElement("div");
  metaLine.className = "bon-reported-item-meta";

  metaLine.appendChild(buildUserButton(row.username, onSelectUser));

  const metaParts: string[] = [];
  if (row.entry.subreddit) {
    metaParts.push(row.entry.subreddit);
  }

  if (row.entry.kind) {
    metaParts.push(row.entry.kind);
  }

  metaParts.push(`reported ${formatDate(row.entry.at)}`);

  const metaText = document.createElement("span");
  metaText.textContent = metaParts.join(" · ");
  metaLine.appendChild(metaText);

  metaLine.appendChild(buildStatusStamp(row.entry));

  li.appendChild(metaLine);

  return li;
}

function buildItemTitle(entry: HistoryEntry): HTMLElement {
  const text = entry.postTitle || entry.permalink || "(not captured)";

  if (!entry.permalink) {
    const span = document.createElement("span");
    span.className = "bon-reported-item-title bon-pii";
    span.textContent = text;
    return span;
  }

  const link = document.createElement("a");
  link.className = "bon-reported-item-title bon-pii";
  link.href = `https://www.reddit.com${entry.permalink}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;

  return link;
}

function buildUserButton(
  username: string,
  onSelectUser: (username: string) => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-reported-user bon-pii-name";
  button.textContent = `u/${username}`;
  button.title = "Open dossier";
  button.addEventListener("click", () => onSelectUser(username));

  return button;
}

function buildStatusStamp(entry: HistoryEntry): HTMLSpanElement {
  const stamp = document.createElement("span");
  stamp.className = "bon-reported-status";

  if (!entry.status) {
    stamp.classList.add("bon-reported-status--live");
    stamp.textContent = "live";
    stamp.title = "No removal observed yet";
    return stamp;
  }

  if (entry.status === "removed" || entry.status === "deleted") {
    stamp.classList.add(`bon-reported-status--${entry.status}`);
  }

  stamp.textContent = entry.status;
  if (entry.statusCheckedAt) {
    stamp.title = `Seen ${entry.status} ${formatDate(entry.statusCheckedAt)}`;
  }

  return stamp;
}
