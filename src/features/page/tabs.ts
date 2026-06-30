// Tab bar for the reports page. Owns activation, the `?tab=` URL param,
// and the tab-name allowlist.

const PAGE_TABS = [
  "redditors",
  "metrics",
  "personas",
  "fieldguide",
  "subreddits",
  "settings",
] as const;
export type PageTab = (typeof PAGE_TABS)[number];
const PAGE_DEFAULT_TAB: PageTab = "redditors";
const PAGE_URL_TAB_PARAM = "tab";

export interface PageTabsHandle {
  activate(target: PageTab): void;
  current(): PageTab;
}

// onActivate fires whenever the visible tab changes (user click or
// programmatic activate), so the orchestrator can render that tab's content on
// demand instead of eagerly painting every tab up front. It is not fired for
// the initial URL-restored tab — the orchestrator handles that one itself.
export interface PageTabsOptions {
  onActivate?: (tab: PageTab) => void;
}

export function pageInitTabs(options: PageTabsOptions = {}): PageTabsHandle {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".bon-tab");
  const panels = document.querySelectorAll<HTMLElement>(".bon-tab-panel");

  let currentTab: PageTab = readTabFromUrl();

  const setActive = (target: PageTab): void => {
    currentTab = target;

    for (const other of tabs) {
      const isActive = other.dataset.tab === target;
      other.classList.toggle("bon-tab--active", isActive);
      other.setAttribute("aria-selected", isActive ? "true" : "false");
    }

    for (const panel of panels) {
      panel.hidden = panel.id !== `bon-panel-${target}`;
    }
  };

  const activate = (target: PageTab): void => {
    setActive(target);
    options.onActivate?.(target);
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      if (!target || !isBonPageTab(target)) {
        return;
      }

      activate(target);
      writeTabToUrl(target);
    });
  }

  if (currentTab !== PAGE_DEFAULT_TAB) {
    setActive(currentTab);
  }

  return {
    activate: (target) => {
      activate(target);
      writeTabToUrl(target);
    },
    current: () => currentTab,
  };
}

function isBonPageTab(value: string): value is PageTab {
  return (PAGE_TABS as readonly string[]).includes(value);
}

function readTabFromUrl(): PageTab {
  const raw = new URLSearchParams(window.location.search).get(
    PAGE_URL_TAB_PARAM
  );
  const trimmed = raw?.trim();
  return trimmed && isBonPageTab(trimmed) ? trimmed : PAGE_DEFAULT_TAB;
}

function writeTabToUrl(tab: PageTab): void {
  const params = new URLSearchParams(window.location.search);
  const current = params.get(PAGE_URL_TAB_PARAM);

  if (tab === PAGE_DEFAULT_TAB) {
    if (current === null) {
      return;
    }

    params.delete(PAGE_URL_TAB_PARAM);
  } else {
    if (current === tab) {
      return;
    }

    params.set(PAGE_URL_TAB_PARAM, tab);
  }

  const query = params.toString();
  const newUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState({}, "", newUrl);
}
