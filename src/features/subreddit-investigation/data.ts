// DOM helpers for subreddit-investigation: detect that we're on a
// subreddit feed page, locate the page header for the trigger-button
// anchor, and scrape post-author usernames from the visible feed.
//
// Scope is intentionally narrow — we only target subreddit feed pages
// (/r/<sub>, optionally with a sort suffix), not single-post pages
// (/r/<sub>/comments/...), not wiki / about / mod pages. Single posts
// don't carry the kind of multi-author signal the analysis needs.

export const BON_SUBREDDIT_SAMPLE_SIZE = 10;

// Authors that don't represent a real account on the post-author axis:
// [deleted] is Reddit's tombstone for removed bylines, AutoModerator is a
// subreddit's own mod bot. Either polluting the sample with consistent
// "bot" verdicts would skew every sub toward compromised.
const BON_EXCLUDED_AUTHORS = new Set(["[deleted]", "automoderator"]);

const BON_SUBREDDIT_PATH_RE =
  /^\/r\/([^/]+)\/?(?:(?:hot|new|top|rising|controversial)\/?)?$/i;

export interface BonSubredditPageContext {
  name: string;
  nameKey: string;
}

export function bonSubredditCurrentPage(): BonSubredditPageContext | null {
  const match = window.location.pathname.match(BON_SUBREDDIT_PATH_RE);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (!raw) {
    return null;
  }

  return {
    name: raw,
    nameKey: raw.toLowerCase(),
  };
}

// The subreddit-page masthead — the container that holds the banner,
// the avatar, the H1, and any header chrome. We anchor below it (rather
// than next to the H1) because Reddit's avatar typically overlaps the
// banner above and overflows the header's row; placing the widget
// inside that row leaves it competing for vertical space with the
// avatar. Sitting underneath the whole masthead sidesteps the problem.
export function bonSubredditFindMasthead(): HTMLElement | null {
  return document.querySelector(".masthead") as HTMLElement | null;
}

// Walk the page's <shreddit-post> elements and pull a deduped list of
// post-author usernames. Order = DOM order, which matches whatever sort
// the user happens to be on — fine per design (any 10 posts will do).
export function bonSubredditScrapeAuthors(): string[] {
  return collectAuthors(BON_SUBREDDIT_SAMPLE_SIZE);
}

// Count of unique scrapeable post-authors currently in the DOM, uncapped.
// Drives the "scroll for more posts" gate — Reddit loads ~4 posts on first
// paint and lazy-loads the rest as the user scrolls, so we keep the
// trigger button disabled until enough authors are reachable.
export function bonSubredditCountScrapeableAuthors(): number {
  return collectAuthors(Infinity).length;
}

function collectAuthors(limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const post of document.querySelectorAll("shreddit-post")) {
    const author = post.getAttribute("author");
    if (!author) {
      continue;
    }

    const trimmed = author.trim();
    if (!trimmed) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (BON_EXCLUDED_AUTHORS.has(lower)) {
      continue;
    }

    if (seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    out.push(trimmed);

    if (out.length >= limit) {
      break;
    }
  }

  return out;
}
