// Surfaces the Reddit client's global rate-limit pause inside the queue's
// own "In progress" section, so the operator sees one signal — paused
// queue + countdown — colocated with the queued/running rows it explains.
// While paused, every Reddit fetch in the background blocks (see
// src/reddit/client.ts) and the investigation queue stops promoting
// queued records to running.

import { clientSubscribe } from "../../client.ts";

interface QueuePauseDeps {
  pauseEl: HTMLElement;
  onChange: () => void;
}

let currentPausedUntil: number | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

export function queuePauseIsActive(): boolean {
  return currentPausedUntil !== null && currentPausedUntil > Date.now();
}

export function queuePauseInit(deps: QueuePauseDeps): void {
  void refresh(deps);

  clientSubscribe((event) => {
    if (event.type === "reddit-pause-changed") {
      void refresh(deps);
    }
  });
}

async function refresh(deps: QueuePauseDeps): Promise<void> {
  const wasActive = queuePauseIsActive();

  try {
    const raw = (await browser.storage.local.get("redditPauseUntil")) as {
      redditPauseUntil?: number;
    };

    currentPausedUntil =
      typeof raw.redditPauseUntil === "number" ? raw.redditPauseUntil : null;
  } catch (error) {
    console.error("[Bot or Not] failed to read Reddit pause state", error);
    currentPausedUntil = null;
  }

  render(deps);

  if (wasActive !== queuePauseIsActive()) {
    deps.onChange();
  }
}

function render(deps: QueuePauseDeps): void {
  const { pauseEl } = deps;

  const remainingMs =
    currentPausedUntil !== null ? currentPausedUntil - Date.now() : 0;

  if (remainingMs > 0) {
    const seconds = Math.ceil(remainingMs / 1000);
    pauseEl.hidden = false;
    pauseEl.textContent = `⏸ Queue paused · Reddit rate-limited, resuming in ${seconds}s`;

    if (countdownTimer === null) {
      countdownTimer = setInterval(() => render(deps), 1000);
    }

    return;
  }

  pauseEl.hidden = true;
  pauseEl.textContent = "";

  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  // Pause just expired; the section's visibility/title may need to flip
  // back if it was being kept open solely by the pause.
  if (currentPausedUntil !== null) {
    currentPausedUntil = null;
    deps.onChange();
  }
}
