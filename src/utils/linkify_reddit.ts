// Turns r/<sub> and u/<user> mentions inside a plain-text string into
// clickable links. Returns a DocumentFragment of interleaved text nodes
// and <a> nodes — drop it into any container that would otherwise have
// received `.textContent = text`.
//
// `r/<sub>` mentions always link to Reddit (we don't render subreddits).
// `u/<user>` mentions default to in-page `?user=<name>` so a click stays
// inside the reports page. Content scripts injecting into Reddit pages
// override `userHref` with an absolute URL to the reports page and pass
// `userLinkTarget: "_blank"` so the click opens our app in a new tab.

const REDDIT_REF_RE =
  /(?<![A-Za-z0-9_/])\/?(r\/[A-Za-z0-9_]{2,21}|u\/[A-Za-z0-9_-]{2,21})/gi;

export interface LinkifyOptions {
  userHref?: (username: string) => string;
  userLinkTarget?: string;
}

function defaultUserHref(username: string): string {
  return `?user=${encodeURIComponent(username)}`;
}

// Options for content scripts injecting linkified text into Reddit pages.
// A relative `?user=` href would resolve against the Reddit URL, so the
// reports page URL has to be absolute and the click has to open a new tab.
export function linkifyPanelOptions(): LinkifyOptions {
  const reportsUrl = browser.runtime.getURL("src/reports.html");
  return {
    userHref: (username) =>
      `${reportsUrl}?user=${encodeURIComponent(username)}`,
    userLinkTarget: "_blank",
  };
}

export function linkifyReddit(
  text: string,
  options: LinkifyOptions = {}
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!text) {
    return fragment;
  }

  const userHref = options.userHref ?? defaultUserHref;
  const userLinkTarget = options.userLinkTarget;

  let cursor = 0;

  for (const match of text.matchAll(REDDIT_REF_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
    }

    const [kindRaw, name] = match[1].split("/");
    const kind = kindRaw.toLowerCase();

    const link = document.createElement("a");
    link.className = "bon-reddit-link";
    link.textContent = match[0];

    if (kind === "u") {
      link.href = userHref(name);
      if (userLinkTarget) {
        link.target = userLinkTarget;
        link.rel = "noopener noreferrer";
      }
    } else {
      link.href = `https://www.reddit.com/${kind}/${name}/`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    fragment.appendChild(link);

    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}
