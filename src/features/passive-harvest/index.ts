// Content-script side of passive harvesting. On every MutationObserver
// tick the orchestrator calls passiveHarvestTick, which walks the
// freshly-rendered DOM for posts / comments authored by hidden-profile
// users we've previously investigated. Hits accumulate in an in-memory
// buffer and flush to the background after a quiet window so a
// "load more comments" expansion that surfaces 50 items in the same
// frame only triggers one storage write, not 50.
//
// Two things keep this cheap on big threads:
// 1. The hidden-username set is loaded once and refreshed via the client
//    subscription. Per-tick lookup is O(1).
// 2. Every shreddit-post / shreddit-comment / .thing we scan is marked
//    with data-bon-harvested so subsequent ticks skip it — see scrape.ts.

import { clientSend, clientSubscribe } from "../../client.ts";
import type { PassiveHarvestFinding } from "./scrape.ts";
import { passiveHarvestScrape } from "./scrape.ts";

const FLUSH_DELAY_MS = 3000;

let hiddenUsernames = new Set<string>();
let hiddenUsernamesLoaded = false;

interface BufferedFinding {
  username: string;
  item: PassiveHarvestFinding["item"];
}

const pending: BufferedFinding[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function loadHiddenUsernames(): Promise<void> {
  const response = await clientSend<{ usernames?: string[] }>({
    type: "get-hidden-usernames",
  });

  hiddenUsernames = new Set(
    (response?.usernames ?? []).map((name) => name.toLowerCase())
  );
  hiddenUsernamesLoaded = true;
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  if (pending.length === 0) {
    return;
  }

  // Group by username so the background does one merge per user instead
  // of one per finding. On a thread where the same hidden user posted
  // many comments, this collapses N writes into one.
  const byUser = new Map<string, PassiveHarvestFinding["item"][]>();

  for (const finding of pending.splice(0)) {
    const existing = byUser.get(finding.username);
    if (existing) {
      existing.push(finding.item);
    } else {
      byUser.set(finding.username, [finding.item]);
    }
  }

  for (const [username, items] of byUser) {
    void clientSend({
      type: "passive-harvest",
      username,
      items,
    });
  }
}

export function passiveHarvestTick(): void {
  if (!hiddenUsernamesLoaded || hiddenUsernames.size === 0) {
    return;
  }

  const findings = passiveHarvestScrape(hiddenUsernames);
  if (findings.length === 0) {
    return;
  }

  for (const finding of findings) {
    pending.push(finding);
  }

  scheduleFlush();
}

export function passiveHarvestInit(): void {
  void loadHiddenUsernames();

  clientSubscribe((event) => {
    if (event.type === "reports-changed") {
      void loadHiddenUsernames();
    }
  });

  // Don't lose buffered finds when the tab is closed or backgrounded.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pending.length > 0) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      void flush();
    }
  });
}

export {
  passiveHarvestGetHiddenUsernames,
  passiveHarvestRecord,
} from "./handlers.ts";
export type { PassiveHarvestFinding } from "./scrape.ts";
