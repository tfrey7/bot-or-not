// Reported tab — every post/comment the operator has reported, across all
// users, newest first. Takedown stamps come from two directions: the passive
// status-detection scanner as the operator browses past reported posts, and
// the background re-check sweep (recheck.ts) that probes still-live
// permalinks for moderator takedowns.

import { reportedPostsList } from "./list.ts";
import {
  reportedPostsApplyFilter,
  reportedPostsCollect,
  reportedPostsCounts,
  type ReportedHistorySlice,
  type ReportedPostsCounts,
  type ReportedPostsFilter,
} from "./logic.ts";

export { reportedPostsGetHistory } from "./handlers.ts";
export { reportedPostsRecheckSweep } from "./recheck.ts";
export type { ReportedHistorySlice } from "./logic.ts";

export interface RenderReportedPostsOptions {
  onSelectUser: (username: string) => void;
}

export function renderReportedPostsTab(
  reports: ReportedHistorySlice[],
  container: HTMLElement | null,
  options: RenderReportedPostsOptions
): void {
  if (!container) {
    return;
  }

  const rows = reportedPostsCollect(reports);
  const counts = reportedPostsCounts(rows);

  const section = document.createElement("section");
  section.className = "bon-reported";
  section.appendChild(buildHeader(counts));

  const listHost = document.createElement("div");

  let filter: ReportedPostsFilter = "all";
  const repaintList = (): void => {
    listHost.replaceChildren(
      reportedPostsList(
        reportedPostsApplyFilter(rows, filter),
        options.onSelectUser
      )
    );
  };

  section.appendChild(
    buildFilterRow(counts, (next) => {
      filter = next;
      repaintList();
    })
  );
  section.appendChild(listHost);
  repaintList();

  container.replaceChildren(section);
}

function buildHeader(counts: ReportedPostsCounts): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-reported-header";

  const title = document.createElement("h2");
  title.textContent = "Reported posts";
  header.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "bon-reported-subtitle";
  subtitle.textContent =
    counts.total === 0
      ? "Nothing reported yet — hit report on a post or comment on Reddit and it lands here."
      : "Every report you've filed, newest first. Still-live posts are re-checked in the background every few days; takedown stamps also appear as you browse past reported posts again.";
  header.appendChild(subtitle);

  return header;
}

function buildFilterRow(
  counts: ReportedPostsCounts,
  onChange: (filter: ReportedPostsFilter) => void
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "bon-reported-filters";

  const filters: Array<{ filter: ReportedPostsFilter; label: string }> = [
    { filter: "all", label: `All ${counts.total}` },
    { filter: "taken-down", label: `Taken down ${counts.takenDown}` },
    { filter: "live", label: `Still live ${counts.live}` },
  ];

  for (const { filter, label } of filters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bon-reported-filter";
    if (filter === "all") {
      button.classList.add("bon-reported-filter--active");
    }

    button.textContent = label;
    button.addEventListener("click", () => {
      for (const sibling of row.children) {
        sibling.classList.toggle(
          "bon-reported-filter--active",
          sibling === button
        );
      }

      onChange(filter);
    });

    row.appendChild(button);
  }

  return row;
}
