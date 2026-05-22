// One-click "is this subreddit compromised?" feature. Injected on
// subreddit feed pages (/r/<sub>). The widget shows a verdict badge if
// the sub has been analyzed before, plus an Analyze / Re-analyze button
// that samples post-authors from the current DOM and feeds them through
// the existing per-user investigation queue.
//
// Verdict is derived live from the sampled users' Report records — the
// badge refreshes as individual investigations land via reports-changed.

import { bonClientSend, bonClientSubscribe } from "../../client.ts";
import type { SubredditReport } from "../../types.ts";
import {
  BON_SUBREDDIT_SAMPLE_SIZE,
  bonSubredditCountScrapeableAuthors,
  bonSubredditCurrentPage,
  bonSubredditFindMasthead,
  bonSubredditScrapeAuthors,
  type BonSubredditPageContext,
} from "./data.ts";
import type { BonSubredditVerdict } from "./verdict.ts";

const CONTAINER_ID = "bon-subreddit-investigation";

interface State {
  context: BonSubredditPageContext;
  record: SubredditReport | null;
  verdict: BonSubredditVerdict | null;
  busy: boolean;
  scrapeableCount: number;
}

let currentState: State | null = null;
let fetchInFlight = false;

function isMisplaced(container: HTMLElement): boolean {
  return !!container.closest("shreddit-post, shreddit-comment, article");
}

function hasEnoughPosts(state: State): boolean {
  return state.scrapeableCount >= BON_SUBREDDIT_SAMPLE_SIZE;
}

function renderStatusText(state: State): string {
  if (state.busy) {
    return "Kicking off analysis…";
  }

  // Verdict text always wins when we have one to show — keep it visible
  // even on partly-loaded feeds, since the button hint already explains
  // why Re-analyze is locked.
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

  if (!hasEnoughPosts(state)) {
    return `Only ${state.scrapeableCount} of ${BON_SUBREDDIT_SAMPLE_SIZE} posts loaded — scroll the feed to load more.`;
  }

  return "No analysis yet — sample 10 recent posts' authors.";
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

  return state.record ? "Re-analyze" : "Analyze 10 recent authors";
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
  const locked = !state.busy && !hasEnoughPosts(state);
  button.disabled = state.busy || locked;
  if (locked) {
    button.title = `Scroll the feed to load at least ${BON_SUBREDDIT_SAMPLE_SIZE} posts, then click to analyze.`;
  }

  button.addEventListener("click", () => {
    void handleAnalyzeClick();
  });

  container.appendChild(button);

  return container;
}

function render(state: State): void {
  const masthead = bonSubredditFindMasthead();
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
  verdict: BonSubredditVerdict | null;
}> {
  try {
    const response = await bonClientSend<{
      ok?: boolean;
      record?: SubredditReport | null;
      verdict?: BonSubredditVerdict | null;
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
  const context = bonSubredditCurrentPage();
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
    const liveContext = bonSubredditCurrentPage();
    if (!liveContext || liveContext.nameKey !== context.nameKey) {
      return;
    }

    currentState = {
      context: liveContext,
      record,
      verdict,
      busy: currentState?.busy ?? false,
      scrapeableCount: bonSubredditCountScrapeableAuthors(),
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

  const authors = bonSubredditScrapeAuthors();
  if (authors.length === 0) {
    return;
  }

  currentState = { ...currentState, busy: true };
  render(currentState);

  try {
    await bonClientSend({
      type: "analyze-subreddit",
      name: currentState.context.name,
      authors,
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

export function bonSubredditInvestigationTick(): void {
  const context = bonSubredditCurrentPage();

  if (!context) {
    if (currentState) {
      currentState = null;
      document.getElementById(CONTAINER_ID)?.remove();
    }

    return;
  }

  if (!bonSubredditFindMasthead()) {
    return;
  }

  // No in-memory state yet for this sub — kick a fetch (which will render).
  if (!currentState || currentState.context.nameKey !== context.nameKey) {
    void refresh();
    return;
  }

  // State is for the right sub. Re-render if the DOM was reparented away,
  // if our placement got misplaced, or if more posts have streamed in and
  // the scrapeable count has shifted (unlocks / re-locks the button).
  const existing = document.getElementById(CONTAINER_ID) as HTMLElement | null;
  const scrapeableCount = bonSubredditCountScrapeableAuthors();

  if (
    !existing ||
    isMisplaced(existing) ||
    existing.dataset.subreddit !== context.nameKey ||
    currentState.scrapeableCount !== scrapeableCount
  ) {
    currentState = { ...currentState, scrapeableCount };
    render(currentState);
  }
}

export function bonSubredditInvestigationInit(): void {
  bonSubredditInvestigationTick();

  bonClientSubscribe((event) => {
    if (
      event.type !== "reports-changed" &&
      event.type !== "subreddits-changed"
    ) {
      return;
    }

    if (!bonSubredditCurrentPage()) {
      return;
    }

    void refresh();
  });
}
