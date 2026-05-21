// Reports-page orchestrator. Owns the load / render / poll loop, the
// search input, the analytics container, and the confirm modal. Each row
// + cell renderer lives in its own file in this directory; this file
// just wires them together. Sort order is fixed (most-recently-
// investigated first) so a fresh investigation always floats to the top.

import {
  bonAiCommandFormatSummary,
  type AiCommandAction,
  type AiCommandResult,
} from "../ai-command";
import { bonRenderAnalytics } from "../analytics";
import { bonRenderDiagnostics } from "../diagnostics";
import { bonRenderSelfImprovement } from "../self-improvement";
import { bonRenderSync } from "../sync";
import { BON_REGION_INFO } from "../regions/data.ts";
import type { Report } from "../../types.ts";
import { bonExpectedDurationMs } from "../../utils/expected_duration.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsDetailEmpty, bonReportsDetailPane } from "./detail_pane.ts";
import { bonReportsInitConfirmModal } from "./confirm_modal.ts";
import { bonReportsInitJazzLogo } from "./jazz_logo.ts";
import {
  bonReportsInitSettings,
  bonReportsOpenSettings,
  bonReportsRefreshApiKeyStatus,
} from "./settings.ts";
import { bonReportsPagination } from "./pagination.ts";
import { bonReportsRow } from "./table_row.ts";
import {
  bonReportsCompareActive,
  bonReportsCompareBy,
  bonReportsCountQueuedAhead,
  bonReportsDiagnoseLoadError,
  bonReportsFormatRunningCellText,
  bonReportsFormatRunningTitle,
  bonReportsHasStructuralChange,
  bonReportsIsActiveRow,
  type ReportRow,
} from "./logic.ts";

const tbody = document.getElementById("bon-tbody") as HTMLTableSectionElement;
const tableWrap = document.getElementById("bon-table-wrap") as HTMLElement;
const activeTbody = document.getElementById(
  "bon-tbody-active"
) as HTMLTableSectionElement;
const activeSection = document.getElementById(
  "bon-active-section"
) as HTMLElement;
const activeTitleEl = document.getElementById(
  "bon-active-title"
) as HTMLElement;
const emptyEl = document.getElementById("bon-empty") as HTMLElement;
const detailPane = document.getElementById("bon-detail-pane") as HTMLElement;
const searchInput = document.getElementById("bon-search") as HTMLInputElement;
const commandStatusEl = document.getElementById(
  "bon-command-status"
) as HTMLElement;
const paginationContainer = document.getElementById(
  "bon-pagination-container"
) as HTMLElement;
const analyticsContainer = document.getElementById(
  "bon-analytics-container"
) as HTMLElement | null;
const diagnosticsContainer = document.getElementById(
  "bon-diagnostics-container"
) as HTMLElement | null;
const selfImprovementContainer = document.getElementById(
  "bon-self-improvement-container"
) as HTMLElement | null;
const syncContainer = document.getElementById(
  "bon-sync-container"
) as HTMLElement | null;

const BON_REPORTS_PAGE_SIZE = 20;
const BON_REPORTS_URL_USER_PARAM = "user";
const BON_REPORTS_URL_TAB_PARAM = "tab";
const BON_REPORTS_DEFAULT_TAB = "reports";
const BON_REPORTS_TABS = [
  "reports",
  "metrics",
  "diagnostics",
  "self-improvement",
  "settings",
] as const;
type BonReportsTab = (typeof BON_REPORTS_TABS)[number];

// Vite inlines import.meta.env.DEV at build time, so the suffix only ships
// in `vite dev` builds — published AMO builds (vite build) get a clean
// version string.
const versionEl = document.getElementById("bon-version");
if (versionEl) {
  const version = browser.runtime.getManifest().version;
  versionEl.textContent = import.meta.env.DEV ? `${version} (dev)` : version;
}

// Dev-only agent identity: when this build is running from a worktree spawned
// by new-agent.sh, __BON_AGENT__ is the agent slug. Prefix the tab title and
// drop a hash-colored badge into the masthead so it's unmistakable which
// agent's code is loaded. Tree-shakes out for published builds (__BON_AGENT__
// is null).
if (__BON_AGENT__) {
  document.title = `[${__BON_AGENT__}] ${document.title}`;

  const titlesEl = document.querySelector(".bon-header-titles");
  if (titlesEl) {
    const palette = [
      "#d97757",
      "#7ba6d9",
      "#a9b665",
      "#d79921",
      "#b16286",
      "#83a598",
      "#fe8019",
      "#d3869b",
    ];

    let hash = 0;

    for (const ch of __BON_AGENT__) {
      hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    }

    const color = palette[Math.abs(hash) % palette.length];

    const badge = document.createElement("span");
    badge.className = "bon-dev-agent-badge";
    badge.textContent = `AGENT · ${__BON_AGENT__.toUpperCase()}`;
    badge.title = `Dev build running from worktree: ${__BON_AGENT__}`;
    Object.assign(badge.style, {
      display: "inline-block",
      marginTop: "6px",
      padding: "2px 8px",
      background: color,
      color: "#1a1410",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.08em",
      borderRadius: "3px",
    });
    titlesEl.appendChild(badge);
  }
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
let currentPage = 1;
let selectedUsername: string | null = readSelectedUsernameFromUrl();

// Tracks which selection the detail pane last animated for, so polling-driven
// re-renders (activity load, in-flight investigation ticks) don't re-fire the
// swap animation. `undefined` means "no render yet" — the first render is
// silent so deep-linked loads don't fade in on page open.
let lastAnimatedSelection: string | null | undefined = undefined;

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

// Username allowlist set by the AI command agent's `filter_users` tool. When
// non-null, render() intersects the visible rows with this set on top of any
// search-text filter. Cleared on Esc, on the Clear-filter button, on a new
// search-shaped keystroke, or by the agent itself with an empty list.
let agentFilter: Set<string> | null = null;
const agentFilterEl = document.getElementById(
  "bon-agent-filter"
) as HTMLElement;
const agentFilterLabelEl = document.getElementById(
  "bon-agent-filter-label"
) as HTMLElement;
const agentFilterClearBtn = document.getElementById(
  "bon-agent-filter-clear"
) as HTMLButtonElement;

agentFilterClearBtn.addEventListener("click", () => {
  clearAgentFilter();
});

// Each fresh load of the reports page starts a new AI conversation. The
// background keeps the transcript across messages within one page session,
// but a refresh wipes it — keeps the lifetime intuitive and avoids needing
// any user-facing reset control.
void browser.runtime.sendMessage({ type: "ai-command-reset" }).catch(() => {});

// While any investigation is "running", poll storage so the elapsed timer
// ticks and completion/error transitions land without a manual refresh.
// storage.onChanged should cover the transitions but doesn't always fire
// reliably across extension pages, so the poll is the source of truth.
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 1000;

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes.reports) {
    // Route through the poll path so non-structural writes (notes, lazy
    // profile-stat fills) don't tear down whichever widget the operator
    // is currently typing into. pollTick still does a full re-render when
    // something actually changed structurally.
    void pollTick();
  }

  if (changes.claudeApiKey) {
    void refreshApiKeyState();
  }
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  const raw = searchInput.value.trim();
  if (!raw) {
    return;
  }

  event.preventDefault();
  void runAiCommand(raw);
});

bonReportsInitConfirmModal({ onConfirm: load });
bonReportsInitSettings();
bonReportsInitJazzLogo();

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !agentFilter) {
    return;
  }

  // The confirm modal's own Esc handler runs alongside this one; if it's
  // open, let it win and leave the filter for the next Esc press.
  const confirmModal = document.getElementById("bon-confirm-modal");
  if (confirmModal && !confirmModal.hidden) {
    return;
  }

  clearAgentFilter();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }

  event.preventDefault();
  searchInput.focus();
  searchInput.select();
});

initTabs();
initStickyShellMeasurement();

bonRenderSync(syncContainer);

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
    renderSelfImprovement();
  } catch (error) {
    console.error("[Bot or Not] failed to load reports", error);
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    renderLoadError(error);
  }
}

async function refreshApiKeyState(): Promise<void> {
  void bonReportsRefreshApiKeyStatus();

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

function renderSelfImprovement(): void {
  if (!selfImprovementContainer) {
    return;
  }

  const reportsMap: Record<string, Report> = {};

  for (const row of allReports) {
    reportsMap[row.username] = row;
  }

  bonRenderSelfImprovement(reportsMap, selfImprovementContainer);
}

function render(): void {
  expectedDurationMs = bonExpectedDurationMs(allReports);
  renderAgentFilterBanner();

  if (
    pendingSelectionUsername &&
    allReports.some((report) => report.username === pendingSelectionUsername)
  ) {
    selectedUsername = pendingSelectionUsername;
    pendingScrollToSelected = true;
    pendingSelectionUsername = null;
    updateUrlForSelection();
  }

  // URL deep-links from the inline-tag flyout's "open dossier" button pass
  // the lowercased tag key as ?user=, but storage preserves whatever case
  // Reddit handed back when the record was created. Resolve to the stored
  // case once data is loaded so the strict-equality checks below
  // (filter membership, active-row detection, detail lookup) all succeed.
  if (selectedUsername) {
    const canonical = allReports.find(
      (report) =>
        report.username.toLowerCase() === selectedUsername!.toLowerCase()
    );

    if (canonical && canonical.username !== selectedUsername) {
      selectedUsername = canonical.username;
      updateUrlForSelection();
    }
  }

  const filtered = allReports.filter((report) => {
    if (agentFilter && !agentFilter.has(report.username)) {
      return false;
    }

    return true;
  });

  const activeRows = filtered.filter(bonReportsIsActiveRow);
  const doneRows = filtered.filter((report) => !bonReportsIsActiveRow(report));

  activeRows.sort(bonReportsCompareActive);
  doneRows.sort(bonReportsCompareBy("investigatedAt", "desc", REGION_LABELS));

  activeTbody.replaceChildren();
  tbody.replaceChildren();
  paginationContainer.replaceChildren();

  renderActiveSection(activeRows);

  if (filtered.length === 0) {
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    selectedUsername = null;
    updateUrlForSelection();
    pendingScrollToSelected = false;
    renderEmptyState();
    renderDetail();
    ensurePolling();
    return;
  }

  emptyEl.hidden = true;

  if (
    selectedUsername &&
    !filtered.some((report) => report.username === selectedUsername)
  ) {
    selectedUsername = null;
    updateUrlForSelection();
    pendingScrollToSelected = false;
  }

  const selectedIsActive =
    !!selectedUsername &&
    activeRows.some((report) => report.username === selectedUsername);

  if (pendingScrollToSelected && selectedUsername && !selectedIsActive) {
    const idx = doneRows.findIndex(
      (report) => report.username === selectedUsername
    );

    if (idx >= 0) {
      currentPage = Math.floor(idx / BON_REPORTS_PAGE_SIZE) + 1;
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil(doneRows.length / BON_REPORTS_PAGE_SIZE)
  );

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  if (currentPage < 1) {
    currentPage = 1;
  }

  const pageStart = (currentPage - 1) * BON_REPORTS_PAGE_SIZE;
  const pageEnd = pageStart + BON_REPORTS_PAGE_SIZE;
  const pageRows = doneRows.slice(pageStart, pageEnd);

  for (const report of pageRows) {
    const summary = bonReportsRow(report, {
      selectedUsername,
      queueAhead: bonReportsCountQueuedAhead(allReports, report),
      onSelect: selectRow,
    });
    tbody.appendChild(summary);
  }

  tableWrap.hidden = doneRows.length === 0;

  const shouldScrollToSelection = pendingScrollToSelected && !!selectedUsername;

  if (shouldScrollToSelection) {
    const scope = selectedIsActive ? activeTbody : tbody;
    const row = scope.querySelector<HTMLTableRowElement>(
      `.bon-row-summary[data-bon-username="${CSS.escape(selectedUsername!)}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }

  pendingScrollToSelected = false;

  if (totalPages > 1) {
    paginationContainer.appendChild(
      bonReportsPagination({
        currentPage,
        totalPages,
        totalItems: doneRows.length,
        pageSize: BON_REPORTS_PAGE_SIZE,
        onPageChange: (next) => {
          currentPage = next;
          render();
        },
      })
    );
  }

  renderDetail();

  // Deep-link arrivals (URL ?user=, AI-command navigate, empty-state
  // investigate) want the dossier in view, not just the row. With the
  // sticky shell holding the page header, the row scroll alone leaves the
  // detail pane below the fold on narrow screens. Detail pane's
  // scroll-margin-top already accounts for the sticky shell height.
  if (shouldScrollToSelection) {
    detailPane.scrollIntoView({ block: "start" });
  }

  ensurePolling();
}

function renderActiveSection(rows: ReportRow[]): void {
  if (rows.length === 0) {
    activeSection.hidden = true;
    return;
  }

  activeSection.hidden = false;
  activeTitleEl.textContent = `In progress · ${rows.length}`;

  for (const report of rows) {
    const summary = bonReportsRow(report, {
      selectedUsername,
      queueAhead: bonReportsCountQueuedAhead(allReports, report),
      onSelect: selectRow,
    });
    activeTbody.appendChild(summary);
  }
}

function selectRow(username: string): void {
  if (selectedUsername === username) {
    return;
  }

  selectedUsername = username;
  updateUrlForSelection();

  const rows = document.querySelectorAll<HTMLTableRowElement>(
    "#bon-tbody .bon-row-summary, #bon-tbody-active .bon-row-summary"
  );

  for (const row of rows) {
    const isSelected = row.dataset.bonUsername === username;
    row.classList.toggle("bon-row-summary--selected", isSelected);
    row.setAttribute("aria-pressed", isSelected ? "true" : "false");
  }

  renderDetail();

  // Bring the dossier top into view (scroll-margin-top on .bon-split-detail
  // leaves room for the sticky header). No-op if it's already in position.
  detailPane.scrollIntoView({ block: "start", behavior: "smooth" });
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

    maybeAnimateDetailSwap();
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

    maybeAnimateDetailSwap();
    return;
  }

  detailPane.appendChild(
    bonReportsDetailPane(report, {
      expectedDurationMs,
      queueAhead: bonReportsCountQueuedAhead(allReports, report),
      onNoApiKey: bonReportsOpenSettings,

      // Bounce back to page 1 — the fixed investigatedAt-desc sort will
      // float the freshly-kicked row to the top once the storage write
      // and re-render cycle lands.
      onInvestigate: () => {
        currentPage = 1;
      },
    })
  );

  maybeAnimateDetailSwap();
}

function maybeAnimateDetailSwap(): void {
  const isFirstRender = lastAnimatedSelection === undefined;
  const changed = lastAnimatedSelection !== selectedUsername;
  lastAnimatedSelection = selectedUsername;

  if (isFirstRender || !changed) {
    return;
  }

  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (reduced) {
    return;
  }

  detailPane.animate(
    [
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 200, easing: "ease-out" }
  );
}

function renderEmptyState(): void {
  emptyEl.replaceChildren();

  const text = document.createElement("p");
  text.className = "bon-empty-text";
  text.textContent = agentFilter
    ? "No reports match the active filter."
    : "No reports yet. Flag a Reddit user from their profile page to start tracking.";

  emptyEl.appendChild(text);
}

function ensurePolling(): void {
  const anyLive = allReports.some((report) => {
    const status = report.investigation?.status;
    if (status === "queued") {
      return true;
    }

    return (
      status === "running" && !bonIsInvestigationStale(report.investigation)
    );
  });

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
      renderSelfImprovement();
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
  expectedDurationMs = bonExpectedDurationMs(allReports);

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

// Publish the sticky header+tabs block's measured height as a CSS variable
// so .bon-split-detail can pin itself flush against the bottom of the sticky
// shell. The shell's height varies — it grows when the command status line
// appears and when the header wraps at narrow widths — so observe rather
// than measure once.
function initStickyShellMeasurement(): void {
  const shell = document.querySelector<HTMLElement>(".bon-sticky-shell");
  if (!shell) {
    return;
  }

  const publish = (): void => {
    document.documentElement.style.setProperty(
      "--bon-sticky-shell-height",
      `${shell.offsetHeight}px`
    );
  };

  publish();
  new ResizeObserver(publish).observe(shell);
}

function initTabs(): void {
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

    // Note edits don't trigger a structural re-render, so refresh on
    // activation to pick up changes made since this tab was last opened.
    if (target === "self-improvement") {
      renderSelfImprovement();
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      if (!target || !isBonReportsTab(target)) {
        return;
      }

      activate(target);
      updateUrlForTab(target);
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

function updateUrlForTab(tab: BonReportsTab): void {
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

let commandInflight = false;

async function runAiCommand(input: string): Promise<void> {
  if (commandInflight) {
    return;
  }

  commandInflight = true;
  searchInput.disabled = true;
  setCommandStatus("running", `Running: ${input}`);

  try {
    const response = (await browser.runtime.sendMessage({
      type: "ai-command",
      input,
    })) as AiCommandResult | { ok: false; error: string };

    if (!response?.ok) {
      const error = (response as { error?: string })?.error ?? "unknown error";
      if (error === "no-api-key") {
        setCommandStatus("error", "No Claude API key — add one in Settings.");
      } else {
        setCommandStatus("error", `Command failed: ${error}`);
      }

      return;
    }

    const result = response as AiCommandResult;
    const summary = bonAiCommandFormatSummary(result.summary);
    setCommandStatus("ok", summary, { html: true });
    searchInput.value = "";
    currentPage = 1;
    await load();
    applyClientActions(result.actions);
  } catch (error) {
    console.error("[Bot or Not] ai-command failed", error);
    setCommandStatus(
      "error",
      `Command failed: ${String(
        (error as { message?: string })?.message ?? error
      )}`
    );
  } finally {
    commandInflight = false;
    searchInput.disabled = false;
    searchInput.focus();
  }
}

// Some agent tools (navigate_to_user, filter_users) are UI-side effects
// rather than storage mutations — the background returns ok with hints, and
// we apply them here once the data reload settles. Iterate in order so a
// multi-step command can end on a specific selection or filter.
function applyClientActions(actions: AiCommandAction[]): void {
  for (const action of actions) {
    if (!action.ok) {
      continue;
    }

    if (action.tool === "navigate_to_user") {
      const resolved =
        (action.result as { username?: string } | undefined)?.username ??
        (action.input as { username?: string }).username;

      if (!resolved) {
        continue;
      }

      const match = allReports.find(
        (report) => report.username.toLowerCase() === resolved.toLowerCase()
      );

      if (!match) {
        continue;
      }

      selectedUsername = match.username;
      updateUrlForSelection();
      pendingScrollToSelected = true;
      render();
    }

    if (action.tool === "filter_users") {
      const usernames = (action.input as { usernames?: unknown }).usernames;
      const list = Array.isArray(usernames) ? (usernames as string[]) : [];
      if (list.length === 0) {
        clearAgentFilter();
      } else {
        // Resolve to canonical stored keys (case-insensitive) so the filter
        // works even if Claude shifted casing.
        const resolved = new Set<string>();

        for (const name of list) {
          const match = allReports.find(
            (report) => report.username.toLowerCase() === name.toLowerCase()
          );

          if (match) {
            resolved.add(match.username);
          }
        }

        agentFilter = resolved;
        currentPage = 1;
        renderAgentFilterBanner();
        render();
      }
    }
  }
}

function clearAgentFilter(): void {
  if (!agentFilter) {
    return;
  }

  agentFilter = null;
  currentPage = 1;
  renderAgentFilterBanner();
  render();
}

function renderAgentFilterBanner(): void {
  if (!agentFilter) {
    agentFilterEl.hidden = true;
    agentFilterLabelEl.textContent = "";
    return;
  }

  agentFilterEl.hidden = false;
  agentFilterLabelEl.textContent = `AI filter · showing ${agentFilter.size} of ${allReports.length} users`;
}

function setCommandStatus(
  kind: "running" | "ok" | "error" | "hidden",
  content: string,
  options: { html?: boolean } = {}
): void {
  if (kind === "hidden") {
    commandStatusEl.hidden = true;
    commandStatusEl.textContent = "";
    return;
  }

  commandStatusEl.hidden = false;
  if (options.html) {
    commandStatusEl.innerHTML = content;
  } else {
    commandStatusEl.textContent = content;
  }

  commandStatusEl.classList.remove(
    "bon-command-status--running",
    "bon-command-status--ok",
    "bon-command-status--error"
  );
  commandStatusEl.classList.add(`bon-command-status--${kind}`);
}
