// Subreddits tab. Lists every subreddit the operator has analyzed, with a
// derived verdict (compromised / healthy / inconclusive / pending) and the
// per-sample author breakdown. Click a sample's username to jump to its
// dossier in the Reports tab.
//
// The page-level orchestrator owns the data fetch — it calls
// `bonRenderSubreddits` on initial load and again whenever the
// `subreddits` storage key changes OR per-user investigations complete
// (since verdicts derive from those reports).

import { bonClientSend } from "../../client.ts";
import type {
  BonSubredditListEntry,
  BonSubredditListResult,
} from "../subreddit-investigation/handlers.ts";
import { bonRenderSubredditsList } from "./list.ts";

export async function bonRenderSubreddits(
  container: HTMLElement | null
): Promise<void> {
  if (!container) {
    return;
  }

  let entries: BonSubredditListEntry[] = [];
  try {
    const response = await bonClientSend<BonSubredditListResult>({
      type: "list-subreddit-reports",
    });
    entries = response?.entries ?? [];
  } catch (error) {
    console.error(
      "[Bot or Not] subreddits tab: list-subreddit-reports failed",
      error
    );
  }

  container.replaceChildren(bonRenderSubredditsList(entries));
}
