// "Reported posts" panel in the detail pane — every post/comment the
// operator has reported for this user, newest first, stamped with any
// removal status the status-detection feature has passively observed
// since. This is the look-back surface for "did my report get actioned?".

import type { HistoryEntry } from "../../types.ts";
import { formatDate } from "../../utils/format_time.ts";
import type { ReportRow } from "./logic.ts";

export function redditorsReportedPostsSection(
  report: ReportRow
): HTMLDivElement | null {
  if (report.history.length === 0) {
    return null;
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap bon-reported-posts";

  wrap.appendChild(buildTitleRow(report.history));
  wrap.appendChild(buildList(report.history));

  return wrap;
}

function buildTitleRow(history: HistoryEntry[]): HTMLDivElement {
  const titleRow = document.createElement("div");
  titleRow.className = "bon-reported-posts__title-row";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Reported posts";
  titleRow.appendChild(title);

  const takenDown = history.filter((entry) => entry.status).length;

  const meta = document.createElement("span");
  meta.className = "bon-reported-posts__meta";

  const parts = [`${history.length} report${history.length === 1 ? "" : "s"}`];
  if (takenDown > 0) {
    parts.push(`${takenDown} taken down`);
  }

  meta.textContent = parts.join(" · ");
  titleRow.appendChild(meta);

  return titleRow;
}

function buildList(history: HistoryEntry[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "bon-reported-posts__items";

  const sorted = [...history].sort((a, b) => b.at - a.at);

  for (const entry of sorted) {
    list.appendChild(buildItem(entry));
  }

  return list;
}

function buildItem(entry: HistoryEntry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-reported-posts__item";

  li.appendChild(buildItemTitle(entry));

  const metaLine = document.createElement("div");
  metaLine.className = "bon-reported-posts__item-meta";

  const metaParts: string[] = [];
  if (entry.subreddit) {
    metaParts.push(entry.subreddit);
  }

  if (entry.kind) {
    metaParts.push(entry.kind);
  }

  metaParts.push(`reported ${formatDate(entry.at)}`);

  const metaText = document.createElement("span");
  metaText.textContent = metaParts.join(" · ");
  metaLine.appendChild(metaText);

  const status = buildStatusStamp(entry);
  if (status) {
    metaLine.appendChild(status);
  }

  li.appendChild(metaLine);

  return li;
}

function buildItemTitle(entry: HistoryEntry): HTMLElement {
  const text = entry.postTitle || entry.permalink || "(not captured)";

  if (!entry.permalink) {
    const span = document.createElement("span");
    span.className = "bon-reported-posts__item-title bon-pii";
    span.textContent = text;
    return span;
  }

  const link = document.createElement("a");
  link.className = "bon-reported-posts__item-title bon-pii";
  link.href = `https://www.reddit.com${entry.permalink}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;

  return link;
}

function buildStatusStamp(entry: HistoryEntry): HTMLSpanElement | null {
  if (!entry.status) {
    return null;
  }

  const stamp = document.createElement("span");
  stamp.className = "bon-reported-posts__status";

  if (entry.status === "removed" || entry.status === "deleted") {
    stamp.classList.add(`bon-reported-posts__status--${entry.status}`);
  }

  stamp.textContent = entry.status;
  if (entry.statusCheckedAt) {
    stamp.title = `Seen ${entry.status} ${formatDate(entry.statusCheckedAt)}`;
  }

  return stamp;
}
