// Tab bar for the reports page. Owns activation, the `?tab=` URL param,
// and the tab-name allowlist.

const BON_PAGE_TABS = [
  "redditors",
  "metrics",
  "personas",
  "subreddits",
  "settings",
] as const;
export type BonPageTab = (typeof BON_PAGE_TABS)[number];
const BON_PAGE_DEFAULT_TAB: BonPageTab = "redditors";
const BON_PAGE_URL_TAB_PARAM = "tab";

export interface BonPageTabsHandle {
  activate(target: BonPageTab): void;
}

export function bonPageInitTabs(): BonPageTabsHandle {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".bon-tab");
  const panels = document.querySelectorAll<HTMLElement>(".bon-tab-panel");

  const activate = (target: BonPageTab): void => {
    for (const other of tabs) {
      const isActive = other.dataset.tab === target;
      other.classList.toggle("bon-tab--active", isActive);
      other.setAttribute("aria-selected", isActive ? "true" : "false");
    }

    for (const panel of panels) {
      panel.hidden = panel.id !== `bon-panel-${target}`;
    }
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

  const initialTab = readTabFromUrl();
  if (initialTab !== BON_PAGE_DEFAULT_TAB) {
    activate(initialTab);
  }

  return {
    activate: (target) => {
      activate(target);
      writeTabToUrl(target);
    },
  };
}

function isBonPageTab(value: string): value is BonPageTab {
  return (BON_PAGE_TABS as readonly string[]).includes(value);
}

function readTabFromUrl(): BonPageTab {
  const raw = new URLSearchParams(window.location.search).get(
    BON_PAGE_URL_TAB_PARAM
  );
  const trimmed = raw?.trim();
  return trimmed && isBonPageTab(trimmed) ? trimmed : BON_PAGE_DEFAULT_TAB;
}

function writeTabToUrl(tab: BonPageTab): void {
  const params = new URLSearchParams(window.location.search);
  const current = params.get(BON_PAGE_URL_TAB_PARAM);

  if (tab === BON_PAGE_DEFAULT_TAB) {
    if (current === null) {
      return;
    }

    params.delete(BON_PAGE_URL_TAB_PARAM);
  } else {
    if (current === tab) {
      return;
    }

    params.set(BON_PAGE_URL_TAB_PARAM, tab);
  }

  const query = params.toString();
  const newUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState({}, "", newUrl);
}
