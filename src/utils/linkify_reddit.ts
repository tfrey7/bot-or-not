// Turns r/<sub> and u/<user> mentions inside a plain-text string into
// clickable links that open in a new tab. Returns a DocumentFragment of
// interleaved text nodes and <a> nodes — drop it into any container that
// would otherwise have received `.textContent = text`.

const REDDIT_REF_RE = /(?<![A-Za-z0-9_/])\/?(r|u)\/([A-Za-z0-9_-]{2,21})/gi;

export function bonLinkifyReddit(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!text) {
    return fragment;
  }

  let cursor = 0;
  for (const match of text.matchAll(REDDIT_REF_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
    }

    const kind = match[1].toLowerCase();
    const name = match[2];

    const link = document.createElement("a");
    link.href = `https://www.reddit.com/${kind}/${name}/`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "bon-reddit-link";
    link.textContent = match[0];
    fragment.appendChild(link);

    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}
