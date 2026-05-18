// The "Reports (N)" list in the expanded panel body — the user's own
// reporting history for this account, capped at 8 most-recent entries
// with a "+ N older" line for anything beyond.

import type { HistoryEntry, Report } from "../../types.ts";
import { bonFormatPanelDate } from "../../utils/format_time.ts";

function resolveReportUrl(permalink: string | undefined): string | null {
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

function buildReportEntry(entry: HistoryEntry): HTMLLIElement {
  const li = document.createElement("li");

  const time = document.createElement("time");
  if (entry.at) {
    time.dateTime = new Date(entry.at).toISOString();
    time.textContent = bonFormatPanelDate(entry.at);
    time.title = new Date(entry.at).toLocaleString();
  } else {
    time.textContent = "unknown";
  }
  li.appendChild(time);

  const kindIcon =
    entry.kind === "post" ? "📝" : entry.kind === "comment" ? "💬" : "";
  const statusIcon =
    entry.status === "removed" ? "🚫" : entry.status === "deleted" ? "❌" : "";
  const prefix = [statusIcon, kindIcon].filter(Boolean).join(" ");

  const labelParts: string[] = [];
  if (entry.subreddit) {
    labelParts.push(entry.subreddit);
  }
  if (entry.postTitle) {
    labelParts.push(entry.postTitle);
  }

  const labelText =
    (prefix ? `${prefix} ` : "") + (labelParts.join(" · ") || "report");

  const url = resolveReportUrl(entry.permalink);
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = labelText;
    a.title = labelText;
    li.appendChild(a);
  } else {
    const span = document.createElement("span");
    span.textContent = labelText;
    span.title = labelText;
    li.appendChild(span);
  }

  return li;
}

export function bonPanelBuildReportsSection(
  report: Report | null | undefined
): HTMLDivElement {
  const history = report?.history || [];

  const section = document.createElement("div");
  section.className = "bon-panel-section";

  const title = document.createElement("p");
  title.className = "bon-panel-section__title";

  const label = document.createElement("span");
  label.textContent = `Reports (${history.length})`;
  title.appendChild(label);

  section.appendChild(title);

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-panel-empty";
    empty.textContent = "No reports submitted from this extension yet.";
    section.appendChild(empty);
    return section;
  }

  const ul = document.createElement("ul");
  ul.className = "bon-panel-reports";

  const sorted = [...history].sort((a, b) => (b.at || 0) - (a.at || 0));
  const visible = sorted.slice(0, 8);
  for (const entry of visible) {
    ul.appendChild(buildReportEntry(entry));
  }

  section.appendChild(ul);

  if (sorted.length > visible.length) {
    const more = document.createElement("p");
    more.className = "bon-panel-reports__more";
    more.textContent = `+ ${sorted.length - visible.length} older — open the full reports view for all.`;
    section.appendChild(more);
  }

  return section;
}
