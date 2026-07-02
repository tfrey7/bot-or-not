// Subreddits tab — the Preact pilot surface. One root component owns the
// master-detail state; data loads via client messages and reloads on
// reports/subreddits change events, so the page mounts this once and never
// re-renders it by hand.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { clientSend, clientSubscribe } from "../../client.ts";
import type { Report } from "../../types.ts";
import type {
  SubredditListEntry,
  SubredditListResult,
} from "../subreddit-investigation";
import { SubredditsDetail } from "./detail_pane.tsx";
import { SubredditsList } from "./list.tsx";
import { nameKeyOf } from "./logic.ts";

export interface SubredditsTabOptions {
  onSelectUser: (username: string) => void;
}

export function subredditsMountTab(
  container: HTMLElement | null,
  options: SubredditsTabOptions
): void {
  if (!container || container.dataset.bonMounted) {
    return;
  }

  container.dataset.bonMounted = "true";
  render(<SubredditsTab onSelectUser={options.onSelectUser} />, container);
}

interface TabData {
  entries: SubredditListEntry[];
  reportsByUsername: Map<string, Report>;
}

function SubredditsTab({ onSelectUser }: SubredditsTabOptions) {
  const [data, setData] = useState<TabData>({
    entries: [],
    reportsByUsername: new Map(),
  });
  const [selectedNameKey, setSelectedNameKey] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      try {
        const [subsResponse, reportsResponse] = await Promise.all([
          clientSend<SubredditListResult>({ type: "list-subreddit-reports" }),
          clientSend<{ reports?: Record<string, Report> }>({
            type: "get-all-reports",
          }),
        ]);

        if (disposed) {
          return;
        }

        setData({
          entries: subsResponse?.entries ?? [],
          reportsByUsername: new Map(
            Object.entries(reportsResponse?.reports ?? {}).map(
              ([username, report]) => [username.toLowerCase(), report]
            )
          ),
        });
      } catch (error) {
        console.error("[Bot or Not] subreddits tab: load failed", error);
      }
    };

    void load();

    const unsubscribe = clientSubscribe((event) => {
      if (
        event.type === "reports-changed" ||
        event.type === "subreddits-changed"
      ) {
        void load();
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const { entries, reportsByUsername } = data;

  // Sticky selection with a most-recent default: keep the operator's pick
  // while it's still listed, otherwise fall back to the newest analysis.
  const selected =
    entries.find((entry) => nameKeyOf(entry) === selectedNameKey) ??
    entries[0] ??
    null;

  return (
    <>
      <div class="bon-split-list" id="bon-subreddits-list">
        <SubredditsList
          entries={entries}
          selectedNameKey={selected ? nameKeyOf(selected) : null}
          onSelect={setSelectedNameKey}
        />
      </div>
      <aside
        class="bon-split-detail"
        id="bon-subreddits-detail"
        aria-live="polite"
      >
        <SubredditsDetail
          entry={selected}
          reportsByUsername={reportsByUsername}
          hasAnyEntries={entries.length > 0}
          onSelectUser={onSelectUser}
        />
      </aside>
    </>
  );
}
