// Reports-page orchestrator. Owns the load / render / poll loop, the
// search input, the sort header click handlers, the analytics container,
// and the two modals (confirm + settings). Each row + cell renderer
// lives in its own file in this directory; this file just wires them
// together.

import { bonRenderAnalytics } from "../analytics";
import { bonRenderDiagnostics } from "../diagnostics";
import { BON_REGION_INFO } from "../regions/data.ts";
import type { Report } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsDetailEmpty, bonReportsDetailPane } from "./detail_pane.ts";
import {
  bonReportsCloseModalsOnEscape,
  bonReportsInitConfirmModal,
  bonReportsInitSettingsModal,
  bonReportsOpenSettings,
} from "./modals.ts";
import { bonReportsPagination } from "./pagination.ts";
import { bonReportsRow } from "./table_row.ts";
import {
  bonReportsCompareBy,
  bonReportsDefaultDirFor,
  bonReportsDiagnoseLoadError,
  bonReportsExpectedDurationMs,
  bonReportsFormatRunningCellText,
  bonReportsFormatRunningTitle,
  bonReportsHasStructuralChange,
  bonReportsIsActivityFresh,
  bonReportsSanitizeUsernameQuery,
  type ReportRow,
  type SortDir,
  type SortKey,
} from "./logic.ts";

const tbody = document.getElementById("bon-tbody") as HTMLTableSectionElement;
const tableWrap = document.getElementById("bon-table-wrap") as HTMLElement;
const emptyEl = document.getElementById("bon-empty") as HTMLElement;
const detailPane = document.getElementById("bon-detail-pane") as HTMLElement;
const searchInput = document.getElementById("bon-search") as HTMLInputElement;
const paginationContainer = document.getElementById(
  "bon-pagination-container"
) as HTMLElement;
const analyticsContainer = document.getElementById(
  "bon-analytics-container"
) as HTMLElement | null;
const diagnosticsContainer = document.getElementById(
  "bon-diagnostics-container"
) as HTMLElement | null;

const BON_REPORTS_PAGE_SIZE = 50;
const BON_REPORTS_URL_USER_PARAM = "user";
// Vite inlines import.meta.env.DEV at build time, so the suffix only ships
// in `vite dev` builds — published AMO builds (vite build) get a clean
// version string.
const versionEl = document.getElementById("bon-version");
if (versionEl) {
  const version = browser.runtime.getManifest().version;
  versionEl.textContent = import.meta.env.DEV ? `${version} (dev)` : version;
}

const REGION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(BON_REGION_INFO).map(([code, info]) => [code, info.label])
);

let allReports: ReportRow[] = [];
let hasApiKey = false;
// Median duration across all completed runs. Drives the progress ring and
// "~Xs left" countdown on in-flight investigations. Recomputed before
// render and before each poll tick. Null until we have ≥3 completed runs.
let expectedDurationMs: number | null = null;
let sortKey: SortKey = "investigatedAt";
let sortDir: SortDir = "desc";
let currentPage = 1;
let selectedUsername: string | null = readSelectedUsernameFromUrl();
// Set when the selection came from the URL (deep link) and we still need to
// page-jump to it on the next render. Cleared after one render so subsequent
// user-driven paging isn't yanked back.
let pendingScrollToSelected = !!selectedUsername;
// Username to promote to selectedUsername as soon as it shows up in
// allReports. Used by the "Investigate u/<name>" empty-state button: the
// background hasn't written the record yet at click time, so the selection
// is staged here and applied by render() once the record appears via the
// storage-change listener.
let pendingSelectionUsername: string | null = null;
const inflightActivity = new Set<string>();
const selectedForRing = new Set<string>();
let linkMode = false;
let ringStatusMessage: string | null = null;
let ringStatusMessageKind: "info" | "error" = "info";

const ringStatusEl = document.getElementById("bon-ring-status") as HTMLElement;
const ringLinkBtn = document.getElementById(
  "bon-ring-link-btn"
) as HTMLButtonElement;
const ringUnlinkBtn = document.getElementById(
  "bon-ring-unlink-btn"
) as HTMLButtonElement;
const ringModeBtn = document.getElementById(
  "bon-ring-mode-btn"
) as HTMLButtonElement;

ringLinkBtn.addEventListener("click", () => {
  void linkSelectedAsRing();
});
ringUnlinkBtn.addEventListener("click", () => {
  void unlinkSelectedFromRing();
});
ringModeBtn.addEventListener("click", () => {
  toggleLinkMode();
});

// While any investigation is "running", poll storage so the elapsed timer
// ticks and completion/error transitions land without a manual refresh.
// storage.onChanged should cover the transitions but doesn't always fire
// reliably across extension pages, so the poll is the source of truth.
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 1000;

async function loadActivityIfStale(
  username: string,
  activityData: ReportRow["activityData"]
): Promise<void> {
  if (bonReportsIsActivityFresh(activityData)) {
    return;
  }
  if (inflightActivity.has(username)) {
    return;
  }

  inflightActivity.add(username);
  try {
    await browser.runtime.sendMessage({ type: "fetch-activity", username });
  } catch (error) {
    console.error("[Bot or Not] auto-load activity failed", error);
  } finally {
    inflightActivity.delete(username);
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes.reports) {
    void load();
  }
  if (changes.claudeApiKey) {
    void refreshApiKeyState();
  }
});

searchInput.addEventListener("input", () => {
  currentPage = 1;
  render();
});

bonReportsInitConfirmModal({ onConfirm: load });
bonReportsInitSettingsModal();
bonReportsCloseModalsOnEscape();

initTabs();

document
  .querySelectorAll<HTMLTableCellElement>("th.bon-sortable")
  .forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort as SortKey | undefined;
      if (!key) {
        return;
      }

      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir =
          (header.dataset.defaultDir as SortDir) ||
          bonReportsDefaultDirFor(key);
      }

      currentPage = 1;
      render();
    });
  });

await load();

async function load(): Promise<void> {
  try {
    const [{ reports = {} }, { hasKey }] = (await Promise.all([
      browser.runtime.sendMessage({ type: "get-all-reports" }),
      browser.runtime.sendMessage({ type: "get-claude-api-key" }),
    ])) as [{ reports?: Record<string, Report> }, { hasKey: boolean }];

    allReports = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));
    hasApiKey = !!hasKey;

    render();
    renderAnalytics();
    renderDiagnostics();
  } catch (error) {
    console.error("[Bot or Not] failed to load reports", error);
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    renderLoadError(error);
  }
}

async function refreshApiKeyState(): Promise<void> {
  try {
    const { hasKey } = (await browser.runtime.sendMessage({
      type: "get-claude-api-key",
    })) as { hasKey: boolean };
    const next = !!hasKey;
    if (next === hasApiKey) {
      return;
    }
    hasApiKey = next;
    render();
    renderDiagnostics();
  } catch (error) {
    console.error("[Bot or Not] failed to refresh api-key state", error);
  }
}

function renderLoadError(error: unknown): void {
  emptyEl.replaceChildren();

  const heading = document.createElement("p");
  heading.className = "bon-empty-text";
  heading.textContent = "Failed to load reports.";
  emptyEl.appendChild(heading);

  const rawMessage =
    (error as { message?: string })?.message ||
    String(error) ||
    "Unknown error";
  const hint = bonReportsDiagnoseLoadError(rawMessage);

  const detail = document.createElement("p");
  detail.className = "bon-empty-text bon-empty-detail";
  detail.textContent = rawMessage;
  emptyEl.appendChild(detail);

  if (hint) {
    const hintElement = document.createElement("p");
    hintElement.className = "bon-empty-text bon-empty-hint";
    hintElement.textContent = hint;
    emptyEl.appendChild(hintElement);
  }

  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.className = "bon-btn bon-empty-action";
  reloadButton.textContent = "Reload page";

  reloadButton.addEventListener("click", () => {
    location.reload();
  });

  emptyEl.appendChild(reloadButton);
}

// Analytics shows aggregates across every investigation, so it should not
// react to the search input or to every poll tick — only when the
// underlying data actually changes.
function renderAnalytics(): void {
  if (!analyticsContainer) {
    return;
  }
  bonRenderAnalytics(allReports, analyticsContainer);
}

function renderDiagnostics(): void {
  if (!diagnosticsContainer) {
    return;
  }
  const reportsMap: Record<string, Report> = {};
  for (const row of allReports) {
    reportsMap[row.username] = row;
  }
  bonRenderDiagnostics(reportsMap, diagnosticsContainer, {
    apiKeySet: hasApiKey,
  });
}

function render(): void {
  expectedDurationMs = bonReportsExpectedDurationMs(allReports);

  if (
    pendingSelectionUsername &&
    allReports.some((report) => report.username === pendingSelectionUsername)
  ) {
    selectedUsername = pendingSelectionUsername;
    pendingScrollToSelected = true;
    pendingSelectionUsername = null;
    updateUrlForSelection();
  }

  const query = searchInput.value.trim().toLowerCase();

  const filtered = allReports.filter((report) => {
    if (!query) {
      return true;
    }

    const haystack = [
      report.username,
      ...(report.history || []).flatMap((entry) => [
        entry.subreddit,
        entry.postTitle as string | undefined,
      ]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  filtered.sort(bonReportsCompareBy(sortKey, sortDir, REGION_LABELS));

  updateSortIndicators();

  tbody.replaceChildren();
  paginationContainer.replaceChildren();

  if (filtered.length === 0) {
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    selectedUsername = null;
    updateUrlForSelection();
    pendingScrollToSelected = false;
    renderEmptyState(query);
    renderDetail();
    ensurePolling();
    return;
  }

  tableWrap.hidden = false;
  emptyEl.hidden = true;

  if (
    selectedUsername &&
    !filtered.some((report) => report.username === selectedUsername)
  ) {
    selectedUsername = null;
    updateUrlForSelection();
    pendingScrollToSelected = false;
  }

  if (pendingScrollToSelected && selectedUsername) {
    const idx = filtered.findIndex(
      (report) => report.username === selectedUsername
    );
    if (idx >= 0) {
      currentPage = Math.floor(idx / BON_REPORTS_PAGE_SIZE) + 1;
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / BON_REPORTS_PAGE_SIZE)
  );
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  if (currentPage < 1) {
    currentPage = 1;
  }

  const pageStart = (currentPage - 1) * BON_REPORTS_PAGE_SIZE;
  const pageEnd = pageStart + BON_REPORTS_PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageEnd);

  for (const report of pageRows) {
    const summary = bonReportsRow(report, {
      selectedUsername,
      expectedDurationMs,
      isChecked: selectedForRing.has(report.username),
      onSelect: selectRow,
      onToggleCheck: toggleRowSelectedForRing,
    });
    tbody.appendChild(summary);
  }

  if (pendingScrollToSelected && selectedUsername) {
    const row = tbody.querySelector<HTMLTableRowElement>(
      `.bon-row-summary[data-bon-username="${CSS.escape(selectedUsername)}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }
  pendingScrollToSelected = false;

  renderRingControls();

  if (totalPages > 1) {
    paginationContainer.appendChild(
      bonReportsPagination({
        currentPage,
        totalPages,
        totalItems: filtered.length,
        pageSize: BON_REPORTS_PAGE_SIZE,
        onPageChange: (next) => {
          currentPage = next;
          render();
        },
      })
    );
  }

  renderDetail();
  ensurePolling();
}

function selectRow(username: string): void {
  if (selectedUsername === username) {
    return;
  }
  selectedUsername = username;
  updateUrlForSelection();

  for (const row of tbody.querySelectorAll<HTMLTableRowElement>(
    ".bon-row-summary"
  )) {
    const isSelected = row.dataset.bonUsername === username;
    row.classList.toggle("bon-row-summary--selected", isSelected);
    row.setAttribute("aria-pressed", isSelected ? "true" : "false");
  }

  renderDetail();
}

function readSelectedUsernameFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get(
    BON_REPORTS_URL_USER_PARAM
  );
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function updateUrlForSelection(): void {
  const params = new URLSearchParams(window.location.search);
  const current = params.get(BON_REPORTS_URL_USER_PARAM);

  if (selectedUsername) {
    if (current === selectedUsername) {
      return;
    }
    params.set(BON_REPORTS_URL_USER_PARAM, selectedUsername);
  } else {
    if (current === null) {
      return;
    }
    params.delete(BON_REPORTS_URL_USER_PARAM);
  }

  const query = params.toString();
  const newUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState({}, "", newUrl);
}

function toggleRowSelectedForRing(username: string, checked: boolean): void {
  if (checked) {
    selectedForRing.add(username);
  } else {
    selectedForRing.delete(username);
  }
  ringStatusMessage = null;
  renderRingControls();
}

function toggleLinkMode(): void {
  linkMode = !linkMode;
  if (!linkMode) {
    selectedForRing.clear();
    ringStatusMessage = null;
  }
  tableWrap.classList.toggle("bon-table-wrap--link-mode", linkMode);
  renderRingControls();
}

function renderRingControls(): void {
  // Drop selections that no longer point at a real report (search filter
  // hides them but they shouldn't accumulate after deletes).
  for (const name of [...selectedForRing]) {
    if (!allReports.some((report) => report.username === name)) {
      selectedForRing.delete(name);
    }
  }

  if (!linkMode) {
    ringStatusEl.hidden = true;
    ringLinkBtn.hidden = true;
    ringUnlinkBtn.hidden = true;
    ringModeBtn.textContent = "Link rings";
    return;
  }

  ringLinkBtn.hidden = false;
  ringUnlinkBtn.hidden = false;
  ringModeBtn.textContent = "Done";

  const count = selectedForRing.size;
  const distinctRingIds = new Set<string>();
  let anyWithoutRing = false;
  for (const name of selectedForRing) {
    const report = allReports.find((report) => report.username === name);
    if (!report) {
      continue;
    }
    if (report.ringId) {
      distinctRingIds.add(report.ringId);
    } else {
      anyWithoutRing = true;
    }
  }

  ringStatusEl.classList.remove("bon-ring-status--error");
  if (ringStatusMessage) {
    ringStatusEl.textContent = ringStatusMessage;
    ringStatusEl.hidden = false;
    if (ringStatusMessageKind === "error") {
      ringStatusEl.classList.add("bon-ring-status--error");
    }
  } else if (count === 0) {
    ringStatusEl.textContent = "Tick rows to link";
    ringStatusEl.hidden = false;
  } else {
    const ringSummary =
      distinctRingIds.size === 1
        ? ` · ring ${[...distinctRingIds][0]}`
        : distinctRingIds.size > 1
          ? ` · spans ${distinctRingIds.size} rings`
          : "";
    ringStatusEl.textContent = `${count} selected${ringSummary}`;
    ringStatusEl.hidden = false;
  }

  // Link is available when the selection can resolve to a single ring: either
  // brand-new (no existing rings) or extending one existing ring. Two distinct
  // rings in one selection would be a merge — keep that explicit by requiring
  // an unlink first.
  const canLink = count >= 2 && distinctRingIds.size <= 1;
  ringLinkBtn.disabled = !canLink;
  ringLinkBtn.textContent =
    distinctRingIds.size === 1 && anyWithoutRing
      ? `Add to ring ${[...distinctRingIds][0]}`
      : "Link as ring";

  ringUnlinkBtn.disabled = distinctRingIds.size === 0;
}

async function linkSelectedAsRing(): Promise<void> {
  const usernames = [...selectedForRing];
  if (usernames.length < 2) {
    return;
  }

  ringLinkBtn.disabled = true;
  try {
    const response = (await browser.runtime.sendMessage({
      type: "link-ring",
      usernames,
    })) as { ok: boolean; ringId?: string; error?: string };

    if (!response?.ok) {
      ringStatusMessage =
        response?.error === "multiple-existing-rings"
          ? "Selection spans multiple rings — unlink first."
          : `Couldn't link ring: ${response?.error ?? "unknown error"}`;
      ringStatusMessageKind = "error";
      renderRingControls();
      return;
    }

    ringStatusMessage = `Linked as ring ${response.ringId}`;
    ringStatusMessageKind = "info";
    selectedForRing.clear();
    await load();
  } catch (error) {
    console.error("[Bot or Not] link-ring failed", error);
    ringStatusMessage = "Link failed — see console.";
    ringStatusMessageKind = "error";
    renderRingControls();
  }
}

async function unlinkSelectedFromRing(): Promise<void> {
  const usernames = [...selectedForRing];
  if (usernames.length === 0) {
    return;
  }

  ringUnlinkBtn.disabled = true;
  try {
    const response = (await browser.runtime.sendMessage({
      type: "unlink-ring",
      usernames,
    })) as { ok: boolean; error?: string };

    if (!response?.ok) {
      ringStatusMessage = `Couldn't unlink: ${response?.error ?? "unknown error"}`;
      ringStatusMessageKind = "error";
      renderRingControls();
      return;
    }

    ringStatusMessage = `Unlinked ${usernames.length}`;
    ringStatusMessageKind = "info";
    selectedForRing.clear();
    await load();
  } catch (error) {
    console.error("[Bot or Not] unlink-ring failed", error);
    ringStatusMessage = "Unlink failed — see console.";
    ringStatusMessageKind = "error";
    renderRingControls();
  }
}

function renderDetail(): void {
  detailPane.replaceChildren();

  if (!selectedUsername) {
    if (allReports.length === 0) {
      detailPane.appendChild(
        bonReportsDetailEmpty(
          "No reports yet. Flag a Reddit user from their profile to start tracking."
        )
      );
    } else {
      detailPane.appendChild(
        bonReportsDetailEmpty("Select a user from the list to see the dossier.")
      );
    }
    return;
  }

  const report = allReports.find(
    (report) => report.username === selectedUsername
  );
  if (!report) {
    selectedUsername = null;
    detailPane.appendChild(
      bonReportsDetailEmpty("Select a user from the list to see the dossier.")
    );
    return;
  }

  detailPane.appendChild(
    bonReportsDetailPane(report, {
      inflightActivity,
      expectedDurationMs,
      onActivityNeedsLoad: loadActivityIfStale,
      onNoApiKey: bonReportsOpenSettings,
    })
  );
}

function renderEmptyState(query: string): void {
  emptyEl.replaceChildren();

  const text = document.createElement("p");
  text.className = "bon-empty-text";
  if (allReports.length === 0 && !query) {
    text.textContent =
      "No reports yet. Flag a Reddit user from their profile page to start tracking.";
  } else {
    text.textContent = "No reports match the search.";
  }
  emptyEl.appendChild(text);

  if (!query) {
    return;
  }

  const username = bonReportsSanitizeUsernameQuery(query);
  if (!username) {
    return;
  }

  if (!hasApiKey) {
    const hint = document.createElement("p");
    hint.className = "bon-empty-text bon-empty-hint";
    hint.textContent = `Add a Claude API key in Settings to investigate u/${username}.`;
    emptyEl.appendChild(hint);

    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "bon-btn bon-empty-action";
    settingsButton.textContent = "Open Settings";
    settingsButton.addEventListener("click", () => {
      void bonReportsOpenSettings();
    });
    emptyEl.appendChild(settingsButton);
    return;
  }

  const investigateButton = document.createElement("button");
  investigateButton.type = "button";
  investigateButton.className = "bon-btn bon-empty-action";
  investigateButton.textContent = `Investigate u/${username}`;

  investigateButton.addEventListener("click", async () => {
    investigateButton.disabled = true;
    investigateButton.textContent = "Starting…";

    // Clear the search before awaiting — the background writes a "running"
    // record immediately, which fires storage.onChanged and re-renders. If
    // the search is still active at that point, the table collapses to just
    // the new row instead of showing the full list.
    searchInput.value = "";
    sortKey = "investigatedAt";
    sortDir = "desc";
    pendingSelectionUsername = username;
    updateSortIndicators();
    render();

    try {
      const response = (await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      })) as { ok?: boolean; error?: string };

      if (response?.ok === false && response.error === "no-api-key") {
        hasApiKey = false;
        render();
      }
    } catch (error) {
      console.error("[Bot or Not] manual investigate failed", error);
    }
  });

  emptyEl.appendChild(investigateButton);
}

function ensurePolling(): void {
  const anyLive = allReports.some(
    (report) =>
      report.investigation?.status === "running" &&
      !bonIsInvestigationStale(report.investigation)
  );

  if (anyLive && !pollTimer) {
    pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
  } else if (!anyLive && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Poll tick: fetch fresh data but only do a full re-render if something
// structural changed. For a running investigation, just update the
// elapsed time text in place — re-rendering destroys the spinning button
// DOM and restarts its CSS animation, causing a visible jitter every
// tick.
async function pollTick(): Promise<void> {
  try {
    const { reports = {} } = (await browser.runtime.sendMessage({
      type: "get-all-reports",
    })) as { reports?: Record<string, Report> };

    const fresh: ReportRow[] = Object.entries(reports).map(
      ([username, data]) => ({
        username,
        ...data,
      })
    );

    const structuralChange = bonReportsHasStructuralChange(allReports, fresh);
    allReports = fresh;

    if (structuralChange) {
      render();
      renderAnalytics();
      renderDiagnostics();
    } else {
      updateRunningInPlace();
      ensurePolling();
    }
  } catch (error) {
    console.error("[Bot or Not] poll tick failed", error);
  }
}

function updateRunningInPlace(): void {
  // Recompute in case a run completed between full renders and we have a
  // new sample for the median (no full re-render fires for that alone).
  expectedDurationMs = bonReportsExpectedDurationMs(allReports);

  for (const report of allReports) {
    const investigation = report.investigation;
    if (investigation?.status !== "running") {
      continue;
    }
    if (bonIsInvestigationStale(investigation)) {
      continue;
    }
    if (investigation.startedAt === null) {
      continue;
    }

    const elapsedSec = Math.round(
      Math.max(0, Date.now() - investigation.startedAt) / 1000
    );

    const cells = tbody.querySelectorAll<HTMLTableCellElement>(
      "[data-bon-running-cell]"
    );
    for (const cell of cells) {
      if (cell.dataset.bonRunningCell === report.username) {
        cell.textContent = bonReportsFormatRunningCellText(
          elapsedSec,
          expectedDurationMs
        );
      }
    }

    const buttons = document.querySelectorAll<HTMLButtonElement>(
      "[data-bon-running-btn]"
    );
    for (const button of buttons) {
      if (button.dataset.bonRunningBtn !== report.username) {
        continue;
      }
      button.textContent = bonReportsFormatRunningCellText(
        elapsedSec,
        expectedDurationMs
      );
      button.title = bonReportsFormatRunningTitle(
        elapsedSec,
        expectedDurationMs
      );
    }
  }
}

function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".bon-tab");
  const panels = document.querySelectorAll<HTMLElement>(".bon-tab-panel");

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      if (!target) {
        return;
      }
      for (const other of tabs) {
        const isActive = other === tab;
        other.classList.toggle("bon-tab--active", isActive);
        other.setAttribute("aria-selected", isActive ? "true" : "false");
      }
      for (const panel of panels) {
        panel.hidden = panel.id !== `bon-panel-${target}`;
      }
    });
  }
}

function updateSortIndicators(): void {
  document
    .querySelectorAll<HTMLTableCellElement>("th.bon-sortable")
    .forEach((header) => {
      const indicator = header.querySelector(".bon-sort-indicator");
      if (!indicator) {
        return;
      }

      if (header.dataset.sort === sortKey) {
        indicator.textContent = sortDir === "asc" ? "▲" : "▼";
      } else {
        indicator.textContent = "";
      }
    });
}
