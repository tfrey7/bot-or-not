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

import type { Report } from "../../types.ts";

// Cross-feature import: the Google dossier renderer is a shared
// visualization, used by both the reports detail pane and this embed.
// Kept in reports/ for proximity to its only other caller.
import { bonReportsGoogleDossierSection } from "../reports/google_dossier_section.ts";
import type { ReportRow } from "../reports/logic.ts";

const reportCache = new Map<string, Report | null>();

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
  button.title = `Open Google search for u/${username} (site:reddit.com)`;

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
    const dossier = bonReportsGoogleDossierSection({
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

async function refresh(username: string): Promise<void> {
  if (currentProfileUsername() !== username) {
    return;
  }

  let report: Report | null = null;

  try {
    const response = (await browser.runtime.sendMessage({
      type: "get-user-report",
      username,
    })) as { report?: Report | null };

    report = response?.report ?? null;
    reportCache.set(username, report);
  } catch (error) {
    console.error(
      "[Bot or Not] profile-injection: failed to fetch report",
      error
    );
  }

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

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.reports) {
      return;
    }

    const username = currentProfileUsername();
    if (!username) {
      return;
    }

    void refresh(username);
  });
}
