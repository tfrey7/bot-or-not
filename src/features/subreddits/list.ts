// Compact subreddit list — left column of the Subreddits split. One
// selectable row per analyzed sub, sorted most-recent first. The full
// breakdown (sample mix, persona scatter, per-user table) lives in the
// detail pane on the right; this list just gives the operator something
// scannable to click through.

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
  if (entries.length === 0) {
    return buildEmptyState();
  }

  return buildTable(entries, options);
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
