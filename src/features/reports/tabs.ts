// Tab bar for the reports page. Owns activation, the `?tab=` URL param,
// and the tab-name allowlist. The orchestrator wires this up once and
// supplies an "on activate self-improvement" callback because that tab
// re-renders on activation (note edits don't trigger a structural
// re-render of the page).

const BON_REPORTS_TABS = [
  "reports",
  "metrics",
  "diagnostics",
  "self-improvement",
  "settings",
] as const;
export type BonReportsTab = (typeof BON_REPORTS_TABS)[number];
const BON_REPORTS_DEFAULT_TAB: BonReportsTab = "reports";
const BON_REPORTS_URL_TAB_PARAM = "tab";

export interface BonReportsTabsDeps {
  onActivateSelfImprovement(): void;
}

export function bonReportsInitTabs(deps: BonReportsTabsDeps): void {
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

    if (target === "self-improvement") {
      deps.onActivateSelfImprovement();
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
