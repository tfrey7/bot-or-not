// DuckDuckGo HTML-endpoint fetch + parse. We use html.duckduckgo.com
// because it's literally designed to be scrape-friendly (low-bandwidth /
// screen-reader interface) — the HTML structure has been stable for
// years. Bing powers the underlying index so Reddit coverage is solid
// for our `site:reddit.com "<username>"` queries.
//
// Parsing uses `DOMParser`. In the extension's background page (Firefox
// MV3 `"scripts": [...]`) DOMParser is native; in the Node CLI it's
// polyfilled via linkedom at the top of scripts/investigate.ts. This
// keeps the parser one short, robust querySelector chain instead of a
// regex tangle.

import type { WebSearchResult } from "../../types.ts";

const BON_DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const BON_DDG_TIMEOUT_MS = 15_000;
const BON_DDG_MAX_RESULTS = 12;

export interface WebSearchFetchResult {
  results: WebSearchResult[];
  durationMs: number;
  status: "ok" | "error";
  error: string | null;
}

export async function bonDdgSearch(
  query: string
): Promise<WebSearchFetchResult> {
  const startedAt = performance.now();
  const url = `${BON_DDG_HTML_URL}?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BON_DDG_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        // DDG fingerprints bot-shaped User-Agents and serves an anomaly
        // CAPTCHA page instead of results. From the extension this UA
        // already looks browser-like (Firefox sets its own and may
        // override), but from the Node CLI the default UA is
        // `node-fetch/<version>` — which DDG blocks. Hard-coding a real
        // Firefox UA keeps both paths past the heuristic.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        results: [],
        durationMs,
        status: "error",
        error: `DDG HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const results = parseDdgHtml(html).slice(0, BON_DDG_MAX_RESULTS);

    return {
      results,
      durationMs,
      status: "ok",
      error: null,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const message =
      (error as { name?: string })?.name === "AbortError"
        ? `DDG timed out after ${BON_DDG_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error);

    return {
      results: [],
      durationMs,
      status: "error",
      error: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseDdgHtml(html: string): WebSearchResult[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = doc.querySelectorAll<HTMLElement>("div.result");
  const results: WebSearchResult[] = [];

  for (const block of blocks) {
    const titleEl = block.querySelector<HTMLAnchorElement>("a.result__a");
    if (!titleEl) {
      continue;
    }

    const title = (titleEl.textContent ?? "").trim();
    if (!title) {
      continue;
    }

    const snippetEl = block.querySelector<HTMLElement>(".result__snippet");
    const snippet = (snippetEl?.textContent ?? "").trim();

    const urlEl = block.querySelector<HTMLElement>(".result__url");
    const link =
      extractCleanUrl(titleEl.getAttribute("href")) ??
      (urlEl?.textContent ?? "").trim();

    if (!link) {
      continue;
    }

    results.push({ title, snippet, link });
  }

  return results;
}

// DDG result links go through their tracker redirect at /l/?uddg=...
// Unwrap to the underlying target so the prompt sees actual Reddit URLs.
function extractCleanUrl(rawHref: string | null): string | null {
  if (!rawHref) {
    return null;
  }

  try {
    const parsed = new URL(rawHref, "https://duckduckgo.com");
    if (parsed.pathname === "/l/" || parsed.pathname === "/l/.js") {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        return decodeURIComponent(uddg);
      }
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }

    return null;
  } catch {
    return null;
  }
}
