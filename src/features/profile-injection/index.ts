// Embedded Google dossier on Reddit's /user/* profile page. Renders the
// operator-collected Google harvest (subreddits the user has posted in,
// recent post titles, etc.) plus a "Search Google" button to populate it.
// Especially valuable for accounts that have hidden their posts — Reddit
// shows a near-empty page; this fills the void with the dossier we've
// built up from external sources.
//
// The verdict + persona + signals already live in the inline-tag flyout
// (click the chip in the profile H1) — deliberately not duplicated here.
//
// Injection strategy: anchor in Reddit's main content column, below the
// tabs/welcome message. Re-runs on every MutationObserver tick to survive
// SPA reparenting.

import { bonClientSend, bonClientSubscribe } from "../../client.ts";
import type { Report } from "../../types.ts";

// Cross-feature import: the Google dossier renderer is a shared
// visualization, used by both the reports detail pane and this embed.
// Kept in redditors/ for proximity to its only other caller.
import { bonRedditorsGoogleDossierSection, type ReportRow } from "../redditors";

const reportCache = new Map<string, Report | null>();

// Last-rendered harvest signature per user — used to skip the re-render
// when a `reports-changed` event arrives but this user's googleHarvest
// hasn't actually changed. Attribution backfill + passive harvest keep
// writing `reports` for unrelated reasons; rebuilding the dossier on each
// of those churns the DOM (and resets scroll position) for no benefit.
const harvestSignatureCache = new Map<string, string>();

const CONTAINER_ID = "bon-profile-injection";

function findProfileH1(): HTMLHeadingElement | null {
  // Reddit's SPA renders feed items below the profile header, each with
  // its own h1. Skip those — we only want the header's username h1.
  for (const h1 of document.querySelectorAll("h1")) {
    if (h1.closest("shreddit-post, shreddit-comment, article")) {
      continue;
    }

    return h1 as HTMLHeadingElement;
  }

  return null;
}

// Walks up from the profile H1 to the column container that owns both
// the header and the tab/content area. Appending here puts our embed
// below whatever Reddit renders (welcome message, post feed, etc).
// Tabs are identified by `[id^="profile-tab"]` — Reddit's shreddit-app
// gives each profile tab anchor an id like "profile-tab-overview".
function findContentColumn(h1: HTMLHeadingElement): HTMLElement | null {
  let cursor: HTMLElement | null = h1.parentElement;

  while (cursor && cursor !== document.body) {
    if (cursor.querySelector('[id^="profile-tab"]')) {
      return cursor;
    }

    cursor = cursor.parentElement;
  }

  // Fallback: walk up to <main> or shreddit-app and pin to its first child.
  const main = h1.closest(
    'main, [role="main"], shreddit-app'
  ) as HTMLElement | null;

  if (main) {
    return (main.firstElementChild as HTMLElement | null) ?? main;
  }

  return null;
}

function isMisplaced(container: HTMLElement): boolean {
  return !!container.closest("shreddit-post, shreddit-comment, article");
}

function currentProfileUsername(): string | null {
  const match = window.location.pathname.match(/^\/(?:user|u)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function buildGoogleButton(username: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bon-profile-injection__google-btn";
  button.textContent = "Search Google";
  button.title =
    `Open Google search for u/${username} (site:reddit.com). ` +
    `Capture into the dossier requires enabling Google dossier in Settings.`;

  button.addEventListener("click", () => {
    // Quote the username so Google treats it as an exact phrase — without it,
    // word-like handles ("candy", "willy") drown in unrelated reddit.com hits.
    const query = encodeURIComponent(`"${username}" site:reddit.com`);
    window.open(
      `https://www.google.com/search?q=${query}`,
      "_blank",
      "noopener"
    );
  });

  return button;
}

function buildContainer(username: string, report: Report | null): HTMLElement {
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className = "bon-profile-injection";
  container.dataset.username = username;

  const actions = document.createElement("div");
  actions.className = "bon-profile-injection__actions";
  actions.appendChild(buildGoogleButton(username));
  container.appendChild(actions);

  if (report?.googleHarvest && report.googleHarvest.posts.length > 0) {
    const dossier = bonRedditorsGoogleDossierSection({
      ...report,
      username,
    } as ReportRow);

    if (dossier) {
      container.appendChild(dossier);
    }
  } else {
    const empty = document.createElement("p");
    empty.className = "bon-profile-injection__empty";
    empty.textContent =
      "No Google dossier yet — click Search Google to populate.";
    container.appendChild(empty);
  }

  return container;
}

function render(username: string, report: Report | null): void {
  const h1 = findProfileH1();
  if (!h1) {
    return;
  }

  const column = findContentColumn(h1);
  if (!column) {
    return;
  }

  const fresh = buildContainer(username, report);
  const existing = document.getElementById(CONTAINER_ID) as HTMLElement | null;

  if (existing && !isMisplaced(existing) && existing.parentElement === column) {
    existing.replaceWith(fresh);
    return;
  }

  if (existing) {
    existing.remove();
  }

  column.appendChild(fresh);
}

async function fetchReport(username: string): Promise<Report | null> {
  try {
    const response = await bonClientSend<{ report?: Report | null }>({
      type: "get-user-report",
      username,
    });

    return response?.report ?? null;
  } catch (error) {
    console.error(
      "[Bot or Not] profile-injection: failed to fetch report",
      error
    );

    return null;
  }
}

async function refresh(username: string): Promise<void> {
  if (currentProfileUsername() !== username) {
    return;
  }

  const report = await fetchReport(username);
  reportCache.set(username, report);
  harvestSignatureCache.set(
    username,
    harvestRenderSignature(report?.googleHarvest ?? null)
  );
  render(username, report);
}

// Fetch, but only re-render when this user's harvest render signature
// actually changed. The signature cache replaces the old `oldValue` /
// `newValue` diff from `browser.storage.onChanged` — same optimization,
// driven by an in-memory cache that's portable to a server transport.
async function refreshIfHarvestChanged(username: string): Promise<void> {
  if (currentProfileUsername() !== username) {
    return;
  }

  const report = await fetchReport(username);
  reportCache.set(username, report);

  const signature = harvestRenderSignature(report?.googleHarvest ?? null);
  if (signature === harvestSignatureCache.get(username)) {
    return;
  }

  harvestSignatureCache.set(username, signature);
  render(username, report);
}

function ensureInjected(username: string): void {
  if (reportCache.has(username)) {
    render(username, reportCache.get(username) ?? null);
  } else {
    void refresh(username);
  }
}

export function bonProfileInjectionTick(): void {
  const username = currentProfileUsername();

  if (!username) {
    document.getElementById(CONTAINER_ID)?.remove();
    return;
  }

  const existing = document.getElementById(CONTAINER_ID) as HTMLElement | null;
  if (
    existing &&
    !isMisplaced(existing) &&
    existing.dataset.username === username
  ) {
    return;
  }

  if (!findProfileH1()) {
    return;
  }

  ensureInjected(username);
}

export function bonProfileInjectionInit(): void {
  bonProfileInjectionTick();

  bonClientSubscribe((event) => {
    if (event.type !== "reports-changed") {
      return;
    }

    const username = currentProfileUsername();
    if (!username) {
      return;
    }

    void refreshIfHarvestChanged(username);
  });
}

// JSON of just the fields the dossier renders — URL set, attribution,
// title/snippet/meta, and the subreddit aggregates. Deliberately omits
// `lastSeenAt` / `lastCapturedAt` / `captureCount`: every Google nav re-sends
// the same SERP, the merge bumps those cosmetic fields, and we don't want
// to tear down the dossier (collapsing <details>, resetting scroll) every
// time the operator clicks around in Google.
function harvestRenderSignature(harvest: unknown): string {
  if (!harvest || typeof harvest !== "object") {
    return "null";
  }

  const h = harvest as {
    posts?: unknown;
    subredditDistribution?: unknown;
  };

  const posts = Array.isArray(h.posts)
    ? h.posts.map((post) => {
        const p = post as Record<string, unknown>;
        return {
          url: p.url,
          kind: p.kind,
          subreddit: p.subreddit,
          title: p.title,
          ageHint: p.ageHint,
          commentCountHint: p.commentCountHint,
          snippetText: p.snippetText,
          attribution: p.attribution,
          firstSeenAt: p.firstSeenAt,
        };
      })
    : [];

  return JSON.stringify({
    posts,
    subredditDistribution: h.subredditDistribution ?? {},
  });
}
