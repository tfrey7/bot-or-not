// One-click "is this subreddit compromised?" feature. Injected on
// subreddit feed pages (/r/<sub>). The widget shows a verdict badge if
// the sub has been analyzed before, plus an Analyze / Re-analyze button
// that asks the background to pull a fresh author sample from
// /r/<sub>/new.json and feed it through the existing per-user
// investigation queue.
//
// The content script doesn't scrape the DOM or scroll the feed anymore
// — sample sourcing moved into the background so we can target 100
// authors without depending on what the operator has loaded into view.
// Verdict is still derived live from the sampled users' Report records,
// so the badge refreshes as individual investigations land via
// reports-changed.

import { clientSend, clientSubscribe } from "../../client.ts";
import type { SubredditReport } from "../../types.ts";
import {
  SUBREDDIT_SAMPLE_SIZE,
  subredditCurrentPage,
  subredditFindMasthead,
  type SubredditPageContext,
} from "./data.ts";
import type { SubredditVerdict } from "./verdict.ts";

const CONTAINER_ID = "bon-subreddit-investigation";

interface State {
  context: SubredditPageContext;
  record: SubredditReport | null;
  verdict: SubredditVerdict | null;
  busy: boolean;
}

let currentState: State | null = null;
let fetchInFlight = false;

function isMisplaced(container: HTMLElement): boolean {
  return !!container.closest("shreddit-post, shreddit-comment, article");
}

function renderStatusText(state: State): string {
  if (state.busy) {
    return `Sampling ${SUBREDDIT_SAMPLE_SIZE} recent authors…`;
  }

  if (state.record && state.verdict) {
    const { verdict } = state;
    const { doneCount, total, botLeaningCount, errorCount } = verdict;

    if (!verdict.ready) {
      const progress = `${doneCount} / ${total} done`;
      const errors = errorCount > 0 ? ` (${errorCount} errored)` : "";
      return `Analyzing… ${progress}${errors}`;
    }

    if (verdict.inconclusive) {
      return "Inconclusive — couldn't reach enough authors.";
    }

    const summary = `${botLeaningCount} of ${doneCount} sampled authors flagged as bot-leaning`;
    return verdict.compromised
      ? `Compromised — ${summary}.`
      : `Healthy — ${summary}.`;
  }

  return `No analysis yet — sample ${SUBREDDIT_SAMPLE_SIZE} recent post-authors.`;
}

function statusModifier(state: State): string {
  if (state.busy || !state.record || !state.verdict) {
    return "neutral";
  }

  if (!state.verdict.ready) {
    return "pending";
  }

  if (state.verdict.inconclusive) {
    return "neutral";
  }

  return state.verdict.compromised ? "bad" : "good";
}

function buttonLabel(state: State): string {
  if (state.busy) {
    return "Working…";
  }

  return state.record
    ? "Re-analyze"
    : `Analyze ${SUBREDDIT_SAMPLE_SIZE} recent authors`;
}

function buildContainer(state: State): HTMLElement {
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className = "bon-subreddit-investigation";
  container.dataset.subreddit = state.context.nameKey;
  container.dataset.tone = statusModifier(state);

  const status = document.createElement("div");
  status.className = "bon-subreddit-investigation__status";

  const label = document.createElement("strong");
  label.className = "bon-subreddit-investigation__label";
  label.textContent = "Bot or Not";
  status.appendChild(label);

  const text = document.createElement("span");
  text.className = "bon-subreddit-investigation__text";
  text.textContent = renderStatusText(state);
  status.appendChild(text);

  container.appendChild(status);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-subreddit-investigation__btn";
  button.textContent = buttonLabel(state);
  button.disabled = state.busy;

  button.addEventListener("click", () => {
    void handleAnalyzeClick();
  });

  container.appendChild(button);

  return container;
}

function render(state: State): void {
  const masthead = subredditFindMasthead();
  if (!masthead) {
    return;
  }

  const fresh = buildContainer(state);
  const existing = document.getElementById(CONTAINER_ID) as HTMLElement | null;

  // Place as a sibling directly after the masthead. Reddit avatars often
  // overflow the masthead row's bottom edge (overlapping the banner); a
  // widget inside that row competes with the avatar for vertical space.
  // A row-of-its-own below the masthead is clean and predictable.
  if (
    existing &&
    !isMisplaced(existing) &&
    existing.previousElementSibling === masthead
  ) {
    existing.replaceWith(fresh);
    return;
  }

  if (existing) {
    existing.remove();
  }

  masthead.after(fresh);
}

async function fetchSubredditReport(nameKey: string): Promise<{
  record: SubredditReport | null;
  verdict: SubredditVerdict | null;
}> {
  try {
    const response = await clientSend<{
      ok?: boolean;
      record?: SubredditReport | null;
      verdict?: SubredditVerdict | null;
    }>({
      type: "get-subreddit-report",
      name: nameKey,
    });

    return {
      record: response?.record ?? null,
      verdict: response?.verdict ?? null,
    };
  } catch (error) {
    console.error(
      "[Bot or Not] subreddit-investigation: get-subreddit-report failed",
      error
    );

    return { record: null, verdict: null };
  }
}

async function refresh(): Promise<void> {
  const context = subredditCurrentPage();
  if (!context) {
    currentState = null;
    document.getElementById(CONTAINER_ID)?.remove();
    return;
  }

  if (fetchInFlight) {
    return;
  }

  fetchInFlight = true;

  try {
    const { record, verdict } = await fetchSubredditReport(context.nameKey);

    // If the user navigated away mid-fetch, drop the result.
    const liveContext = subredditCurrentPage();
    if (!liveContext || liveContext.nameKey !== context.nameKey) {
      return;
    }

    currentState = {
      context: liveContext,
      record,
      verdict,
      busy: currentState?.busy ?? false,
    };

    render(currentState);
  } finally {
    fetchInFlight = false;
  }
}

async function handleAnalyzeClick(): Promise<void> {
  if (!currentState || currentState.busy) {
    return;
  }

  currentState = { ...currentState, busy: true };
  render(currentState);

  try {
    await clientSend({
      type: "analyze-subreddit",
      name: currentState.context.name,
    });
  } catch (error) {
    console.error(
      "[Bot or Not] subreddit-investigation: analyze-subreddit failed",
      error
    );
  } finally {
    if (currentState) {
      currentState = { ...currentState, busy: false };
    }

    await refresh();
  }
}

export function subredditInvestigationTick(): void {
  const context = subredditCurrentPage();

  if (!context) {
    if (currentState) {
      currentState = null;
      document.getElementById(CONTAINER_ID)?.remove();
    }

    return;
  }

  if (!subredditFindMasthead()) {
    return;
  }

  if (!currentState || currentState.context.nameKey !== context.nameKey) {
    void refresh();
    return;
  }

  // State is for the right sub — re-render if the widget got reparented
  // away from the masthead. (No more scroll-count tracking — the
  // background pulls authors itself, so DOM state on the feed doesn't
  // affect button availability.)
  const existing = document.getElementById(CONTAINER_ID) as HTMLElement | null;

  if (
    !existing ||
    isMisplaced(existing) ||
    existing.dataset.subreddit !== context.nameKey
  ) {
    render(currentState);
  }
}

export function subredditInvestigationInit(): void {
  subredditInvestigationTick();

  clientSubscribe((event) => {
    if (
      event.type !== "reports-changed" &&
      event.type !== "subreddits-changed"
    ) {
      return;
    }

    if (!subredditCurrentPage()) {
      return;
    }

    void refresh();
  });
}

export {
  subredditAnalyze,
  subredditList,
  subredditGetReport,
} from "./handlers.ts";
export type { SubredditListEntry, SubredditListResult } from "./handlers.ts";
export type { SubredditSample, SubredditVerdict } from "./verdict.ts";
