// Subreddits tab orchestrator. Mirrors the Redditors tab's split layout:
// a compact subreddit list on the left and a single-screen dossier on
// the right showing the selected subreddit's verdict, sample mix, and
// persona scatter of just that sub's sampled users.
//
// Selection state lives in this module — the redditors orchestrator
// calls renderSubredditsTab whenever data could have changed
// (`reports-changed`, `subreddits-changed`, initial load), and we
// preserve the operator's selection across re-renders unless the
// selected sub is no longer in the list.

import { clientSend } from "../../client.ts";
import type { Report } from "../../types.ts";
import type {
  SubredditListEntry,
  SubredditListResult,
} from "../subreddit-investigation";
import { renderSubredditsDetail } from "./detail_pane.ts";
import { renderSubredditsList } from "./list.ts";

export interface RenderSubredditsOptions {
  listContainer: HTMLElement | null;
  detailContainer: HTMLElement | null;
  onSelectUser: (username: string) => void;
}

let selectedNameKey: string | null = null;
let lastEntries: SubredditListEntry[] = [];
let lastReportsByUsername: Map<string, Report> = new Map();

export async function renderSubredditsTab(
  options: RenderSubredditsOptions
): Promise<void> {
  const { listContainer, detailContainer, onSelectUser } = options;
  if (!listContainer || !detailContainer) {
    return;
  }

  let entries: SubredditListEntry[] = [];
  let reportsByUsername = new Map<string, Report>();

  try {
    const [subsResponse, reportsResponse] = await Promise.all([
      clientSend<SubredditListResult>({ type: "list-subreddit-reports" }),
      clientSend<{ reports?: Record<string, Report> }>({
        type: "get-all-reports",
      }),
    ]);

    entries = subsResponse?.entries ?? [];

    const reports = reportsResponse?.reports ?? {};
    reportsByUsername = new Map(
      Object.entries(reports).map(([username, report]) => [
        username.toLowerCase(),
        report,
      ])
    );
  } catch (error) {
    console.error("[Bot or Not] subreddits tab: load failed", error);
  }

  lastEntries = entries;
  lastReportsByUsername = reportsByUsername;

  if (selectedNameKey === null && entries.length > 0) {
    // Pre-select the most-recently-analyzed sub on first paint so the
    // detail pane has something to show without an extra click.
    selectedNameKey = nameKeyOf(entries[0]);
  } else if (
    selectedNameKey !== null &&
    !entries.some((entry) => nameKeyOf(entry) === selectedNameKey)
  ) {
    // Previously-selected sub fell out of the list (e.g. cleared).
    selectedNameKey = entries.length > 0 ? nameKeyOf(entries[0]) : null;
  }

  renderList(listContainer, onSelectUser);
  renderDetail(detailContainer, onSelectUser);
}

function nameKeyOf(entry: SubredditListEntry): string {
  return entry.record.name.toLowerCase();
}

function renderList(
  container: HTMLElement,
  onSelectUser: (username: string) => void
): void {
  container.replaceChildren(
    renderSubredditsList(lastEntries, {
      selectedNameKey,
      onSelect: (nameKey) => {
        if (selectedNameKey === nameKey) {
          return;
        }

        selectedNameKey = nameKey;
        renderList(container, onSelectUser);
        const detail = document.getElementById("bon-subreddits-detail");
        if (detail) {
          renderDetail(detail, onSelectUser);
        }
      },
    })
  );
}

function renderDetail(
  container: HTMLElement,
  onSelectUser: (username: string) => void
): void {
  const selected = selectedNameKey
    ? (lastEntries.find((entry) => nameKeyOf(entry) === selectedNameKey) ??
      null)
    : null;

  container.replaceChildren(
    renderSubredditsDetail({
      entry: selected,
      reportsByUsername: lastReportsByUsername,
      hasAnyEntries: lastEntries.length > 0,
      onSelectUser,
    })
  );
}
