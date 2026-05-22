// Tab bar for the reports page. Owns activation, the `?tab=` URL param,
// and the tab-name allowlist.

const BON_REPORTS_TABS = [
  "reports",
  "metrics",
  "personas",
  "settings",
] as const;
export type BonReportsTab = (typeof BON_REPORTS_TABS)[number];
const BON_REPORTS_DEFAULT_TAB: BonReportsTab = "reports";
const BON_REPORTS_URL_TAB_PARAM = "tab";

export interface BonReportsTabsHandle {
  activate(target: BonReportsTab): void;
}

export function bonReportsInitTabs(): BonReportsTabsHandle {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".bon-tab");
  const panels = document.querySelectorAll<HTMLElement>(".bon-tab-panel");

  const activate = (target: BonReportsTab): void => {
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
      if (!target || !isBonReportsTab(target)) {
        return;
      }

      activate(target);
      writeTabToUrl(target);
    });
  }

  const initialTab = readTabFromUrl();
  if (initialTab !== BON_REPORTS_DEFAULT_TAB) {
    activate(initialTab);
  }

  return {
    activate: (target) => {
      activate(target);
      writeTabToUrl(target);
    },
  };
}

function isBonReportsTab(value: string): value is BonReportsTab {
  return (BON_REPORTS_TABS as readonly string[]).includes(value);
}

function readTabFromUrl(): BonReportsTab {
  const raw = new URLSearchParams(window.location.search).get(
    BON_REPORTS_URL_TAB_PARAM
  );
  const trimmed = raw?.trim();
  return trimmed && isBonReportsTab(trimmed)
    ? trimmed
    : BON_REPORTS_DEFAULT_TAB;
}

function writeTabToUrl(tab: BonReportsTab): void {
  const params = new URLSearchParams(window.location.search);
  const current = params.get(BON_REPORTS_URL_TAB_PARAM);

  if (tab === BON_REPORTS_DEFAULT_TAB) {
    if (current === null) {
      return;
    }

    params.delete(BON_REPORTS_URL_TAB_PARAM);
  } else {
    if (current === tab) {
      return;
    }

    params.set(BON_REPORTS_URL_TAB_PARAM, tab);
  }

  const query = params.toString();
  const newUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState({}, "", newUrl);
}
