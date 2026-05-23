// Content script that runs on google.com/search. Activates whenever the
// `q=` param matches our canonical "<username> site:reddit.com" pattern —
// works on page 1 of a button-launched search, on pages 2/3/… of the same
// search (Google preserves q= across pagination), and on any manual search
// in that format. Sends scraped posts to the background; the merge layer
// there unions them into the user's existing harvest.

import { bonClientSend } from "../../client.ts";
import { bonGoogleHarvestParse } from "./parse.ts";
import { bonGoogleHarvestScrape } from "./scrape.ts";

// `"<word>" site:reddit.com` (or unquoted, for back-compat with old launcher
// links and manual searches) — single token before `site:`, no embedded
// spaces. Anchored so unrelated searches (e.g. "user reviews site:reddit.com
// tutorials") don't activate the harvester. Reddit usernames are
// [A-Za-z0-9_-], so the optional surrounding quotes never appear inside the
// captured group.
const QUERY_RE = /^"?([^"\s]+)"?\s+site:reddit\.com\s*$/i;

function readUsernameFromQuery(): string | null {
  const query = new URLSearchParams(window.location.search).get("q");
  if (!query) {
    return null;
  }

  const match = query.trim().match(QUERY_RE);
  return match ? match[1] : null;
}

const username = readUsernameFromQuery();
if (username) {
  let lastCount = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const harvestIfGrown = (): void => {
    const scraped = bonGoogleHarvestScrape();
    if (scraped.length <= lastCount) {
      return;
    }

    lastCount = scraped.length;

    const parsed = bonGoogleHarvestParse(scraped);
    if (parsed.posts.length === 0) {
      return;
    }

    const query = new URLSearchParams(window.location.search).get("q") || "";
    console.log(
      `[Bot or Not] google-harvest: ${parsed.posts.length} Reddit hit(s) for u/${username}`,
      { raw: scraped, parsed }
    );

    void bonClientSend<unknown>({
      type: "google-harvest",
      username,
      query,
      posts: parsed.posts,
    });
  };

  // Catches the synchronous-paint case; the observer below catches the
  // async-paint case (consent flow, JS-driven layout shifts).
  harvestIfGrown();

  const observer = new MutationObserver(() => {
    if (settleTimer) {
      clearTimeout(settleTimer);
    }

    settleTimer = setTimeout(harvestIfGrown, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Stop watching after 8s — Google has either painted by then or it never
  // will. Keeps the observer from running forever on a long-lived tab.
  setTimeout(() => observer.disconnect(), 8000);
}
