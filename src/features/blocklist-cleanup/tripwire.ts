// Content-script tripwire for the blocklist cleanup sweep: watches Reddit
// pages for accounts the sweep unblocked, and reports sightings to the
// background, which verifies the account actually returned to activity
// before re-blocking it. Runs on every observer tick, so the scan marks
// anchors it has already inspected and exits immediately while the
// watchlist is empty.

import { clientSend } from "../../client.ts";

let watchKeys = new Set<string>();
let watchlistLoaded = false;

// One background round-trip per sighted account per page session — retries
// after a failed attempt ride the next page load.
const reported = new Set<string>();

export function blocklistTripwireInit(): void {
  void loadWatchlist();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.blocklistCleanup) {
      void loadWatchlist();
    }
  });
}

async function loadWatchlist(): Promise<void> {
  try {
    const { usernames } = await clientSend<{ usernames: string[] }>({
      type: "blocklist-tripwire-list",
    });

    watchKeys = new Set(usernames);
    watchlistLoaded = true;
  } catch (error) {
    console.warn("[Bot or Not] tripwire: watchlist load failed", error);
  }
}

export function blocklistTripwireScan(): void {
  if (!watchlistLoaded || watchKeys.size === 0) {
    return;
  }

  document
    .querySelectorAll<HTMLAnchorElement>(
      'a[href*="/user/"]:not([data-bon-tripwire]), a[href*="/u/"]:not([data-bon-tripwire])'
    )
    .forEach((anchor) => {
      anchor.dataset.bonTripwire = "";

      const href = anchor.getAttribute("href");
      const match = href?.match(/\/(?:user|u)\/([^/?#]+)/i);
      if (!match) {
        return;
      }

      const username = match[1];
      const key = username.toLowerCase();

      if (!watchKeys.has(key) || reported.has(key)) {
        return;
      }

      reported.add(key);
      void reportSighting(username, key);
    });
}

async function reportSighting(username: string, key: string): Promise<void> {
  const { blocked } = await clientSend<{ blocked: boolean }>({
    type: "blocklist-reblock",
    username,
  });

  if (blocked) {
    watchKeys.delete(key);
  }
}
