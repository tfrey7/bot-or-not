// DOM helpers for the subreddit-investigation feature.
//
// We only inject the analyze widget on subreddit feed pages (/r/<sub>,
// optionally with a sort suffix). Single posts, wikis, mod tools etc.
// don't carry the multi-author signal the analysis needs.
//
// Author sampling itself is *not* done in the content script anymore —
// the background fetches /r/<sub>/new.json directly so we can scale the
// sample to 100 without forcing the operator to scroll the feed (and so
// it goes through the same per-investigation 429 pause path the rest of
// the pipeline uses). What's left here is page detection + masthead
// anchoring for the click target.

export const SUBREDDIT_SAMPLE_SIZE = 100;

const SUBREDDIT_PATH_RE =
  /^\/r\/([^/]+)\/?(?:(?:hot|new|top|rising|controversial)\/?)?$/i;

export interface SubredditPageContext {
  name: string;
  nameKey: string;
}

export function subredditCurrentPage(): SubredditPageContext | null {
  const match = window.location.pathname.match(SUBREDDIT_PATH_RE);
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
export function subredditFindMasthead(): HTMLElement | null {
  return document.querySelector(".masthead") as HTMLElement | null;
}
