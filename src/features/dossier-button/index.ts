// Floating "Add context" pill for reported users. Reddit's faceplate-tracker
// wrappers around comment action buttons use `display: contents` and
// lit-html reconciliation, which makes inline injection unreliable (children
// render at 0x0 or get reaped). We instead append each pill to document.body
// once and absolute-position it under the comment's outer action row.
// Positions refresh on every orchestrator scan tick plus scroll/resize.

import { bonDossierBtnBuild, bonDossierBtnSetState } from "./button.ts";
import type { DossierButtonRefs } from "./button.ts";

// Reported usernames map — populated once on init via get-user-tags, refreshed
// when storage.reports changes. We only care whether a user has a report
// record (button visibility gate).
const reportedUsernames = new Set<string>();
let usernamesLoaded = false;

// Each host (<shreddit-comment> or <shreddit-post>) gets exactly one pill.
// WeakMap so pills GC with their host when Reddit destroys/replaces nodes.
const pillByHost = new WeakMap<HTMLElement, HTMLButtonElement>();
const refsByPill = new WeakMap<HTMLButtonElement, DossierButtonRefs>();
// Anchor element used to compute each pill's position. Tracked separately
// because the anchor may change as Reddit hydrates.
const anchorByPill = new WeakMap<HTMLButtonElement, HTMLElement>();
// All live pills, so we can refresh positions cheaply on scroll/resize
// without re-querying the document.
const livePills = new Set<HTMLButtonElement>();

async function loadReportedUsernames(): Promise<void> {
  const { tags = {} } = (await browser.runtime.sendMessage({
    type: "get-user-tags",
  })) as { tags?: Record<string, unknown> };

  reportedUsernames.clear();
  for (const username of Object.keys(tags)) {
    reportedUsernames.add(username.toLowerCase());
  }
  usernamesLoaded = true;
}

function findShareBtn(scope: Element): HTMLElement | null {
  const aria = scope.querySelector<HTMLElement>(
    'button[aria-label="Share"], a[aria-label="Share"]'
  );
  if (aria) {
    return aria;
  }
  const candidates = scope.querySelectorAll<HTMLElement>(
    'button, a[role="button"]'
  );
  for (const candidate of candidates) {
    if ((candidate.textContent || "").trim().toLowerCase() === "share") {
      return candidate;
    }
  }
  return null;
}

// Walks up from the Share button to find the outermost container that also
// holds a Reply button — the actual visible action-row flex strip. That's
// what we anchor the pill's position to.
function findOuterActionRow(
  scope: Element,
  shareButton: HTMLElement
): HTMLElement | null {
  let current: HTMLElement | null = shareButton.parentElement;
  while (current && current !== scope && current !== document.body) {
    const buttons = current.querySelectorAll<HTMLElement>(
      'button, a[role="button"]'
    );
    for (const button of buttons) {
      if ((button.textContent || "").trim().toLowerCase() === "reply") {
        return current;
      }
    }
    current = current.parentElement;
  }
  return null;
}

function findCommentAnchor(comment: HTMLElement): HTMLElement | null {
  const share = findShareBtn(comment);
  if (!share) {
    return null;
  }
  // Pick the rightmost visible action-row element. The row container can
  // span the full comment body width (which puts the pill out in the
  // sidebar), so we use the rightmost actual button / overflow widget
  // instead. shreddit-overflow-menu is the "..." element; including it
  // here is what stops the pill from landing on top of it.
  const outerRow = findOuterActionRow(comment, share);
  const scope = outerRow || share.parentElement || comment;
  const candidates = scope.querySelectorAll<HTMLElement>(
    'button, a[role="button"], shreddit-overflow-menu, [aria-haspopup]'
  );
  let rightmost: HTMLElement = share;
  let maxRight = share.getBoundingClientRect().right;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.right > maxRight) {
      maxRight = rect.right;
      rightmost = candidate;
    }
  }
  return rightmost;
}

function findPostAnchor(post: HTMLElement): HTMLElement | null {
  // Post action buttons live in Reddit's shadow DOM; we can't reach them
  // directly. The Share dropdown is slotted from light DOM into the action
  // row on the post-detail page — its bounding rect is the most reliable
  // proxy there. On subreddit listing cards the share slot is absent, so
  // pick the rightmost light-DOM slotted child (overflow menu / share /
  // comment-count link) as the row anchor.
  const detailShare = post.querySelector<HTMLElement>(
    'faceplate-dropdown-menu[slot="ssr-share-button"]'
  );
  if (detailShare) {
    return detailShare;
  }
  const slotted = post.querySelectorAll<HTMLElement>("[slot]");
  let rightmost: HTMLElement | null = null;
  let maxRight = -Infinity;
  for (const element of slotted) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    if (rect.right > maxRight) {
      maxRight = rect.right;
      rightmost = element;
    }
  }
  return rightmost;
}

function updatePillPosition(
  pill: HTMLButtonElement,
  anchor: HTMLElement
): void {
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    pill.style.display = "none";
    return;
  }
  pill.style.display = "";
  // Vertical-center on the row, slot in to the right of the rightmost
  // existing button. Below-the-row placement collides with the next nested
  // comment's avatar / the "Join the conversation" composer; right-of-row
  // lands in the empty space all of Reddit's templates leave.
  pill.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
  pill.style.left = `${rect.right + window.scrollX + 8}px`;
}

function refreshAllPositions(): void {
  for (const pill of livePills) {
    const anchor = anchorByPill.get(pill);
    if (!anchor || !anchor.isConnected) {
      continue;
    }
    updatePillPosition(pill, anchor);
  }
}

function createOrReusePill(
  host: HTMLElement,
  username: string,
  permalink: string,
  kind: "post" | "comment",
  anchor: HTMLElement
): { pill: HTMLButtonElement; isNew: boolean } {
  const existing = pillByHost.get(host);
  if (existing && existing.isConnected) {
    anchorByPill.set(existing, anchor);
    return { pill: existing, isNew: false };
  }

  const refs = bonDossierBtnBuild({ username, permalink, kind });
  refs.root.classList.add("bon-dossier-btn--floating");
  document.body.appendChild(refs.root);

  pillByHost.set(host, refs.root);
  refsByPill.set(refs.root, refs);
  anchorByPill.set(refs.root, anchor);
  livePills.add(refs.root);
  return { pill: refs.root, isNew: true };
}

interface HydrationNeeded {
  username: string;
  permalink: string;
  btn: HTMLButtonElement;
}

export function bonDossierButtonMark(): void {
  if (!usernamesLoaded || reportedUsernames.size === 0) {
    return;
  }

  const newlyInjected: HydrationNeeded[] = [];

  document
    .querySelectorAll<HTMLElement>("shreddit-comment[author][permalink]")
    .forEach((comment) => {
      const username = comment.getAttribute("author");
      const permalink = comment.getAttribute("permalink");
      if (
        !username ||
        !permalink ||
        !reportedUsernames.has(username.toLowerCase())
      ) {
        return;
      }
      const anchor = findCommentAnchor(comment);
      if (!anchor) {
        return;
      }
      const { pill, isNew } = createOrReusePill(
        comment,
        username,
        permalink,
        "comment",
        anchor
      );
      updatePillPosition(pill, anchor);
      if (isNew) {
        newlyInjected.push({ username, permalink, btn: pill });
      }
    });

  document
    .querySelectorAll<HTMLElement>("shreddit-post[author][permalink]")
    .forEach((post) => {
      const username = post.getAttribute("author");
      const permalink = post.getAttribute("permalink");
      if (
        !username ||
        !permalink ||
        !reportedUsernames.has(username.toLowerCase())
      ) {
        return;
      }
      const anchor = findPostAnchor(post);
      if (!anchor) {
        return;
      }
      const { pill, isNew } = createOrReusePill(
        post,
        username,
        permalink,
        "post",
        anchor
      );
      updatePillPosition(pill, anchor);
      if (isNew) {
        newlyInjected.push({ username, permalink, btn: pill });
      }
    });

  if (newlyInjected.length > 0) {
    void hydrateDossierState(newlyInjected);
  }
}

// Re-checks every live pill against the latest dossier state. Used after a
// storage change so existing pills (which createOrReusePill skipped because
// they were already present) get their "added" / "default" state refreshed.
async function hydrateAllLivePills(): Promise<void> {
  const items: HydrationNeeded[] = [];
  for (const pill of livePills) {
    if (!pill.isConnected) {
      continue;
    }
    const username = pill.dataset.bonDossierFor || "";
    const permalink = pill.dataset.bonDossierPermalink || "";
    if (!username || !permalink) {
      continue;
    }
    items.push({ username, permalink, btn: pill });
  }
  if (items.length === 0) {
    return;
  }
  // Default every live pill first so a removal flips it back to "Add context"
  // instead of getting stuck on "added".
  for (const item of items) {
    const refs = refsByPill.get(item.btn);
    if (refs && item.btn.dataset.bonDossierState !== "loading") {
      bonDossierBtnSetState(refs, "default");
    }
  }
  await hydrateDossierState(items);
}

async function hydrateDossierState(items: HydrationNeeded[]): Promise<void> {
  try {
    const { map = {} } = (await browser.runtime.sendMessage({
      type: "dossier-has-map",
      queries: items.map((item) => ({
        username: item.username,
        permalink: item.permalink,
      })),
    })) as { map?: Record<string, true> };

    for (const item of items) {
      const refs = refsByPill.get(item.btn);
      if (!refs) {
        continue;
      }
      const key = `${item.username.toLowerCase()}|${normalizePathOnly(item.permalink)}`;
      if (map[key]) {
        bonDossierBtnSetState(refs, "added");
      }
    }
  } catch (error) {
    console.error("[Bot or Not] dossier hydrate failed", error);
  }
}

function normalizePathOnly(permalink: string): string {
  let path = permalink.trim();
  if (path.startsWith("http")) {
    try {
      path = new URL(path).pathname;
    } catch {
      // fall through
    }
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

async function handleClick(button: HTMLButtonElement): Promise<void> {
  const refs = refsByPill.get(button);
  if (!refs) {
    return;
  }
  const username = button.dataset.bonDossierFor || "";
  const permalink = button.dataset.bonDossierPermalink || "";
  const currentState = button.dataset.bonDossierState || "default";

  if (currentState === "loading") {
    return;
  }

  if (currentState === "added") {
    bonDossierBtnSetState(refs, "loading");
    const response = (await browser.runtime.sendMessage({
      type: "dossier-remove",
      username,
      permalink,
    })) as { ok?: boolean };
    bonDossierBtnSetState(refs, response?.ok ? "default" : "error");
    return;
  }

  bonDossierBtnSetState(refs, "loading");
  const response = (await browser.runtime.sendMessage({
    type: "dossier-add",
    username,
    permalink,
  })) as { ok?: boolean; added?: boolean; error?: string };

  if (response?.ok) {
    bonDossierBtnSetState(refs, "added");
  } else {
    bonDossierBtnSetState(refs, "error", response?.error);
  }
}

export function bonDossierButtonInit(): void {
  void loadReportedUsernames().then(() => bonDossierButtonMark());

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const button = target?.closest?.<HTMLButtonElement>(".bon-dossier-btn");
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void handleClick(button);
    },
    true
  );

  // Scroll/resize don't trigger Reddit DOM mutations, so the orchestrator
  // tick won't fire — wire the position refresh directly.
  window.addEventListener("scroll", refreshAllPositions, { passive: true });
  window.addEventListener("resize", refreshAllPositions);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.reports) {
      return;
    }
    void loadReportedUsernames().then(async () => {
      bonDossierButtonMark();
      await hydrateAllLivePills();
    });
  });
}
