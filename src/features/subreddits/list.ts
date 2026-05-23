// Compact subreddit list — left column of the Subreddits split. One
// selectable row per analyzed sub, sorted most-recent first. The full
// breakdown (sample mix, persona scatter, per-user table) lives in the
// detail pane on the right; this list just gives the operator something
// scannable to click through.

import { bonFormatDate } from "../../utils/format_time.ts";
import type { BonSubredditListEntry } from "../subreddit-investigation/handlers.ts";
import type { BonSubredditVerdict } from "../subreddit-investigation/verdict.ts";

interface BonSubredditsListOptions {
  selectedNameKey: string | null;
  onSelect: (nameKey: string) => void;
}

interface VerdictDescriptor {
  badgeModifier: string;
  label: string;
}

export function bonRenderSubredditsList(
  entries: BonSubredditListEntry[],
  options: BonSubredditsListOptions
): HTMLElement {
  const section = document.createElement("section");
  section.className = "bon-subreddits-list";
  section.appendChild(buildHeader(entries.length));

  if (entries.length === 0) {
    section.appendChild(buildEmptyState());
    return section;
  }

  section.appendChild(buildTable(entries, options));
  return section;
}

function buildHeader(count: number): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-subreddits-list-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Subreddits";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-subreddits-list-subtitle";
  sub.textContent =
    count === 0
      ? "Nothing analyzed yet."
      : `${count} sub${count === 1 ? "" : "s"} · verdict updates live`;
  header.appendChild(sub);

  return header;
}

function buildEmptyState(): HTMLElement {
  const div = document.createElement("div");
  div.className = "bon-subreddits-list-empty";
  div.textContent =
    "Open a subreddit on Reddit and use the Bot or Not strip below the banner to kick off an analysis.";

  return div;
}

function buildTable(
  entries: BonSubredditListEntry[],
  options: BonSubredditsListOptions
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-subreddits-list-wrap";

  const table = document.createElement("table");
  table.className = "bon-subreddits-list-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const label of ["Subreddit", "Verdict", "Analyzed"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const entry of entries) {
    tbody.appendChild(buildRow(entry, options));
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildRow(
  entry: BonSubredditListEntry,
  options: BonSubredditsListOptions
): HTMLTableRowElement {
  const { record, verdict } = entry;
  const nameKey = record.name.toLowerCase();
  const descriptor = describeVerdict(verdict);

  const row = document.createElement("tr");
  row.className = "bon-subreddits-list-row";
  row.dataset.subreddit = nameKey;
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute(
    "aria-pressed",
    options.selectedNameKey === nameKey ? "true" : "false"
  );

  if (options.selectedNameKey === nameKey) {
    row.classList.add("bon-subreddits-list-row--selected");
  }

  const select = (): void => {
    options.onSelect(nameKey);
  };

  row.addEventListener("click", select);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });

  const nameCell = document.createElement("td");
  nameCell.className = "bon-subreddits-list-name";
  nameCell.textContent = `r/${record.name}`;
  row.appendChild(nameCell);

  const verdictCell = document.createElement("td");
  verdictCell.className = "bon-subreddits-list-verdict";
  const badge = document.createElement("span");
  badge.className = `bon-verdict-badge bon-verdict-badge--${descriptor.badgeModifier}`;
  badge.textContent = descriptor.label;
  verdictCell.appendChild(badge);
  row.appendChild(verdictCell);

  const analyzedCell = document.createElement("td");
  analyzedCell.className = "bon-subreddits-list-analyzed";
  analyzedCell.textContent =
    record.analyzedAt > 0 ? bonFormatDate(record.analyzedAt) : "—";
  row.appendChild(analyzedCell);

  return row;
}

function describeVerdict(verdict: BonSubredditVerdict): VerdictDescriptor {
  if (!verdict.ready) {
    return { badgeModifier: "queued", label: "Pending" };
  }

  if (verdict.inconclusive) {
    return { badgeModifier: "uncertain", label: "Inconclusive" };
  }

  if (verdict.compromised) {
    return { badgeModifier: "bot", label: "Compromised" };
  }

  return { badgeModifier: "human", label: "Healthy" };
}
