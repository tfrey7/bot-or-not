// Walks a Google SERP DOM and pulls out every Reddit result it can find.
// Google's result-container CSS classes shift constantly, so we anchor on
// stable structure instead: find every <a> whose href points at reddit.com,
// walk up looking for the nearest container that owns an <h3> title, and
// take the rest of that container's text as the snippet. The URL alone is
// already gold (subreddit + post slug embedded), so a missing snippet is
// still a useful result.

export interface BonGoogleResult {
  url: string;
  title: string;
  snippet: string;
}

const REDDIT_HREF_PREFIXES = [
  "https://www.reddit.com/",
  "https://old.reddit.com/",
  "https://reddit.com/",
];

function isRedditHref(href: string): boolean {
  return REDDIT_HREF_PREFIXES.some((prefix) => href.startsWith(prefix));
}

// Strip /url?q=… redirect wrappers that Google sometimes emits for JS-off
// rendering modes. The real URL sits in the q param.
function unwrapHref(href: string): string {
  if (!href.startsWith("https://www.google.com/url")) {
    return href;
  }

  try {
    const url = new URL(href);
    return url.searchParams.get("q") || href;
  } catch {
    return href;
  }
}

function normalizeUrl(href: string): string {
  return href.split("#")[0].split("?")[0].replace(/\/$/, "");
}

export function bonGoogleHarvestScrape(
  doc: Document = document
): BonGoogleResult[] {
  const anchors = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>("a[href]")
  );
  const seen = new Set<string>();
  const results: BonGoogleResult[] = [];

  for (const anchor of anchors) {
    const rawHref = unwrapHref(anchor.href || "");
    if (!isRedditHref(rawHref)) {
      continue;
    }

    const url = normalizeUrl(rawHref);
    if (seen.has(url)) {
      continue;
    }

    // Walk up looking for the nearest container that owns an <h3> — that's
    // Google's title element for a result. Stop after a few hops to avoid
    // sucking in the entire results column.
    let container: HTMLElement | null = anchor;
    let titleEl: HTMLElement | null = anchor.querySelector("h3");

    for (let i = 0; i < 5 && container && !titleEl; i++) {
      container = container.parentElement;
      titleEl = container?.querySelector("h3") ?? null;
    }

    if (!titleEl || !container) {
      // No h3 nearby — probably a sidebar link, a People-Also-Ask snippet,
      // or some other UI chrome. Skip.
      continue;
    }

    const title = (titleEl.textContent || "").trim();
    const containerText = (container.textContent || "").trim();
    const snippet = containerText
      .replace(title, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);

    seen.add(url);
    results.push({ url, title, snippet });
  }

  return results;
}
