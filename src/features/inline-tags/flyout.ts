// The popover that opens when a user clicks an inline tag. Renders the
// same content as the embedded profile panel, but as a viewport-fixed
// flyout anchored to the clicked tag — fetches the report, listens for
// storage changes while open so the panel re-renders mid-investigation,
// dismisses on Escape / click-outside / location change.

import { bonClientSend, bonClientSubscribe } from "../../client.ts";
import type { Report } from "../../types.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";
import { bonPanelBuildProfilePanel } from "../profile-panel";

interface FlyoutState {
  username: string;
  container: HTMLDivElement;
  anchor: HTMLElement;
  unsubscribe: () => void;
  cleanup: () => void;
}

let active: FlyoutState | null = null;

function positionFlyout(container: HTMLElement, anchor: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  const flyoutWidth = container.offsetWidth;
  const flyoutHeight = container.offsetHeight;

  if (!flyoutWidth || !flyoutHeight) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 8;
  const gap = 8;

  let left = anchorRect.left + anchorRect.width / 2 - flyoutWidth / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - margin - flyoutWidth));

  let top = anchorRect.bottom + gap;
  if (top + flyoutHeight > viewportHeight - margin) {
    const flippedTop = anchorRect.top - flyoutHeight - gap;
    if (flippedTop >= margin) {
      top = flippedTop;
    } else {
      top = Math.max(margin, viewportHeight - margin - flyoutHeight);
    }
  }

  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
}

function renderInto(
  container: HTMLElement,
  username: string,
  report: Report | null,
  expectedDurationMs: number | null
): void {
  const panel = bonPanelBuildProfilePanel(username, report, {
    id: "bon-inline-flyout-panel",
    expectedDurationMs,
  });

  // Deliberately do NOT reposition here: the flyout is parked when it opens
  // and stays put for the rest of its lifetime. Re-anchoring on every render
  // (e.g. when status flips to "running" and the slideshow swaps in) would
  // make the box jump as its height changes — and if the new height exceeds
  // the viewport, positionFlyout clamps to (margin, margin), sending the
  // flyout into the corner. onResize handles bounds-keeping on its own.
  container.replaceChildren(panel);
}

interface LoadedReport {
  report: Report | null;
  expectedDurationMs: number | null;
}

async function loadReport(username: string): Promise<LoadedReport> {
  try {
    const response = await bonClientSend<{
      report?: Report | null;
      expectedDurationMs?: number | null;
    }>({
      type: "get-user-report",
      username,
    });

    return {
      report: response?.report ?? null,
      expectedDurationMs: response?.expectedDurationMs ?? null,
    };
  } catch (error) {
    console.error("[Bot or Not] flyout failed to load report", error);
    return { report: null, expectedDurationMs: null };
  }
}

export function bonInlineTagsCloseFlyout(): void {
  if (!active) {
    return;
  }

  active.cleanup();
  active.container.remove();
  active.unsubscribe();
  active = null;
}

export function bonInlineTagsOpenFlyout(
  username: string,
  anchor: HTMLElement
): void {
  // Toggle: clicking the same tag closes the flyout.
  if (active && active.anchor === anchor) {
    bonInlineTagsCloseFlyout();
    return;
  }

  bonInlineTagsCloseFlyout();

  const container = document.createElement("div");
  container.className = "bon-inline-flyout";
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", `Bot or Not — ${username}`);

  // Initial loading shell — replaced once the report fetch resolves. We
  // append before measuring so positionFlyout can read offsetWidth/Height.
  const loading = bonPanelBuildProfilePanel(username, null, {
    id: "bon-inline-flyout-panel",
  });
  container.appendChild(loading);
  document.body.appendChild(container);

  const unsubscribe = bonClientSubscribe((event) => {
    if (event.type !== "reports-changed" || !active) {
      return;
    }

    void loadReport(active.username).then(({ report, expectedDurationMs }) => {
      if (!active) {
        return;
      }

      renderInto(active.container, active.username, report, expectedDurationMs);
    });
  });

  const onDocClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target) {
      return;
    }

    if (target.closest(".bon-inline-flyout")) {
      return;
    }

    if (target.closest(".bon-user-tag")) {
      // Another tag click — let the tag's own handler take over (which
      // toggles or replaces the active flyout).
      return;
    }

    bonInlineTagsCloseFlyout();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      bonInlineTagsCloseFlyout();
    }
  };

  // Reposition on resize only, not scroll — the flyout is position: fixed
  // and should stay parked where it opened, not chase its anchor as the
  // page scrolls. Resize keeps it within viewport bounds.
  const onResize = (): void => {
    if (!active) {
      return;
    }

    positionFlyout(active.container, active.anchor);
  };

  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);

  const cleanup = (): void => {
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  };

  active = { username, container, anchor, unsubscribe, cleanup };

  positionFlyout(container, anchor);

  void loadReport(username).then(({ report, expectedDurationMs }) => {
    if (!active || active.username !== username) {
      return;
    }

    renderInto(active.container, username, report, expectedDurationMs);
    maybeAutoInvestigate(username, report);
  });
}

// Kick off an investigation when the flyout opens on a user we don't yet
// have a (fresh) verdict for. Mirrors what the user would otherwise have to
// click the 🤖 button to do. The storage listener picks up the resulting
// "running" state and re-renders the panel into the loading slideshow.
function maybeAutoInvestigate(username: string, report: Report | null): void {
  const investigation = bonNormalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );

  const running = investigation?.status === "running";
  if (running && !bonIsInvestigationStale(investigation)) {
    return;
  }

  if (investigation?.status === "done") {
    return;
  }

  void browser.runtime
    .sendMessage({ type: "investigate-user", username })
    .catch((error) => {
      console.error("[Bot or Not] flyout auto-investigate failed", error);
    });
}
