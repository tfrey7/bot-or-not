// Content script that runs on google.com/search. Activates whenever the
// `q=` param matches our canonical "<username> site:reddit.com" pattern —
// works on page 1 of a button-launched search, on pages 2/3/… of the same
// search (Google preserves q= across pagination), and on any manual search
// in that format. Sends scraped posts to the background; the merge layer
// there unions them into the user's existing harvest.

import type { BonScrapedPost } from "./parse.ts";
import { bonGoogleHarvestParse } from "./parse.ts";
import { bonGoogleHarvestScrape } from "./scrape.ts";

// `<word> site:reddit.com` — single token before `site:`, no embedded
// quotes or spaces. Anchored so unrelated searches (e.g.
// "user reviews site:reddit.com tutorials") don't activate the harvester.
const QUERY_RE = /^(\S+)\s+site:reddit\.com\s*$/i;

function readUsernameFromQuery(): string | null {
  const query = new URLSearchParams(window.location.search).get("q");
  if (!query) {
    return null;
  }

  const match = query.trim().match(QUERY_RE);
  return match ? match[1] : null;
}

function harvest(username: string): void {
  const scraped = bonGoogleHarvestScrape();
  const parsed = bonGoogleHarvestParse(scraped);
  if (parsed.posts.length === 0) {
    return;
  }

  const query = new URLSearchParams(window.location.search).get("q") || "";
  const payload: {
    type: "google-harvest";
    username: string;
    query: string;
    posts: BonScrapedPost[];
  } = {
    type: "google-harvest",
    username,
    query,
    posts: parsed.posts,
  };

  console.log(
    `[Bot or Not] google-harvest: ${parsed.posts.length} Reddit hit(s) for u/${username}`,
    { raw: scraped, parsed }
  );

  void browser.runtime.sendMessage(payload);
}

const username = readUsernameFromQuery();
if (username) {
  // Google paints results into the DOM after document_idle in many cases
  // (e.g. consent flow, JS-driven layout shifts). One settle delay catches
  // the common case; the MutationObserver below catches the rest.
  setTimeout(() => harvest(username), 400);

  let lastCount = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (settleTimer) {
      clearTimeout(settleTimer);
    }

    settleTimer = setTimeout(() => {
      const scraped = bonGoogleHarvestScrape();
      if (scraped.length > lastCount) {
        lastCount = scraped.length;
        harvest(username);
      }
    }, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Stop watching after 8s — Google has either painted by then or it never
  // will. Keeps the observer from running forever on a long-lived tab.
  setTimeout(() => observer.disconnect(), 8000);
}
