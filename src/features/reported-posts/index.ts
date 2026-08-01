// Reported tab — every post/comment the operator has reported, across all
// users, newest first. Takedown stamps are back-filled by status-detection
// as the operator browses past the reported posts again, so "live" means
// no removal has been observed yet — not that the post was verified up.

import type { Report } from "../../types.ts";
import { reportedPostsList } from "./list.ts";
import {
  reportedPostsApplyFilter,
  reportedPostsCollect,
  reportedPostsCounts,
  type ReportedPostsCounts,
  type ReportedPostsFilter,
} from "./logic.ts";

export interface RenderReportedPostsOptions {
  onSelectUser: (username: string) => void;
}

export function renderReportedPostsTab(
  reports: Array<Report & { username: string }>,
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
      : "Every report you've filed, newest first. Takedown stamps appear as you browse past the reported posts again — a post marked live may just not have been re-seen.";
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
