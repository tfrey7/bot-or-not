// Sticky banner that surfaces the Reddit client's global rate-limit pause.
// While paused, every Reddit fetch in the background blocks (see
// src/reddit/client.ts) and the investigation queue stops promoting
// queued records to running, so the operator needs a visible reason
// nothing is moving.

import { bonClientSubscribe } from "../../client.ts";

const BANNER_ID = "bon-rate-limit-banner";

let countdownTimer: ReturnType<typeof setInterval> | null = null;
let currentPausedUntil: number | null = null;

export function bonPageInitRateLimitBanner(): void {
  void refresh();

  bonClientSubscribe((event) => {
    if (event.type === "reddit-pause-changed") {
      void refresh();
    }
  });
}

async function refresh(): Promise<void> {
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

  render();
}

function render(): void {
  const banner = document.getElementById(BANNER_ID);
  if (!banner) {
    return;
  }

  const remainingMs =
    currentPausedUntil !== null ? currentPausedUntil - Date.now() : 0;

  if (remainingMs > 0) {
    const seconds = Math.ceil(remainingMs / 1000);
    banner.hidden = false;
    banner.textContent = `Reddit rate-limited — investigations paused, resuming in ${seconds}s`;

    if (countdownTimer === null) {
      countdownTimer = setInterval(render, 1000);
    }

    return;
  }

  banner.hidden = true;
  banner.textContent = "";

  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}
