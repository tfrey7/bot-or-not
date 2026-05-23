// Reports-page orchestrator and Redditors-tab renderer. Owns the load +
// render loop and the page-level state (which row is selected, current
// page, expected duration). Tab activation, the AI command bar, and the
// confirm modal live in features/page/; settings UI in features/settings/;
// the polling loop and dossier widgets are siblings here. Sort order is
// fixed (most-recently-investigated first) so a fresh investigation always
// floats to the top.

import { bonClientSend, bonClientSubscribe } from "../../client.ts";
import { bonRenderAnalytics } from "../analytics";
import { BON_INVESTIGATION_CONCURRENCY } from "../investigation/handlers.ts";
import { bonRenderPersonas } from "../personas";
import { bonRenderSubreddits } from "../subreddits";
import { bonRenderSync } from "../sync";
import { BON_REGION_INFO } from "../regions/data.ts";
import type { Report } from "../../types.ts";
import { bonExpectedDurationMs } from "../../utils/expected_duration.ts";
import { bonPiiBlurInit } from "../../utils/pii_blur.ts";
import {
  bonPageInitCommandBar,
  bonPageInitConfirmModal,
  bonPageInitTabs,
  bonPageInstallStrandBadge,
  type BonPageCommandBarHandle,
} from "../page";
import {
  bonSettingsInit,
  bonSettingsOpen,
  bonSettingsRefreshApiKeyStatus,
  bonSettingsStrip,
} from "../settings";
import { bonPagination } from "../../utils/pagination.ts";
import { bonRedditorsInitPolling } from "./polling.ts";
import {
  bonRedditorsDetailEmpty,
  bonRedditorsDetailPane,
} from "./detail_pane.ts";
import { bonQueuePauseInit, bonQueuePauseIsActive } from "./queue_pause.ts";
import { bonRedditorsRow } from "./table_row.ts";
import {
  bonRedditorsCompareActive,
  bonRedditorsCompareBy,
  bonRedditorsCountQueuedAhead,
  bonRedditorsDetailFingerprint,
  bonRedditorsDiagnoseLoadError,
  bonRedditorsIsActiveRow,
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
const queuePauseEl = document.getElementById("bon-queue-pause") as HTMLElement;
const emptyEl = document.getElementById("bon-empty") as HTMLElement;
const detailPane = document.getElementById("bon-detail-pane") as HTMLElement;
const searchInput = document.getElementById("bon-search") as HTMLInputElement;
const agentFilterEl = document.getElementById(
  "bon-agent-filter"
) as HTMLElement;
const agentFilterLabelEl = document.getElementById(
  "bon-agent-filter-label"
) as HTMLElement;
const agentFilterClearBtn = document.getElementById(
  "bon-agent-filter-clear"
) as HTMLButtonElement;
const paginationContainer = document.getElementById(
  "bon-pagination-container"
) as HTMLElement;
const analyticsContainer = document.getElementById(
  "bon-analytics-container"
) as HTMLElement | null;
const personasContainer = document.getElementById(
  "bon-personas-container"
) as HTMLElement | null;
const subredditsListEl = document.getElementById(
  "bon-subreddits-list"
) as HTMLElement | null;
const subredditsDetailEl = document.getElementById(
  "bon-subreddits-detail"
) as HTMLElement | null;
const settingsStripContainer = document.getElementById(
  "bon-settings-strip"
) as HTMLElement | null;
const syncContainer = document.getElementById(
  "bon-sync-container"
) as HTMLElement | null;

const BON_REDDITORS_PAGE_SIZE = 20;
const BON_REDDITORS_URL_USER_PARAM = "user";

// Vite inlines import.meta.env.DEV at build time, so the suffix only ships
// in `vite dev` builds — published AMO builds (vite build) get a clean
// version string.
const versionEl = document.getElementById("bon-version");
if (versionEl) {
  const version = browser.runtime.getManifest().version;
  versionEl.textContent = import.meta.env.DEV ? `${version} (dev)` : version;
}

bonPageInstallStrandBadge();

const REGION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(BON_REGION_INFO).map(([code, info]) => [code, info.label])
);

let allReports: ReportRow[] = [];

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

// Snapshot of the detail pane's last-rendered content. When a sibling row's
// transition triggers a full render but the selected user's own state is
// unchanged, this lets renderDetail bail without tearing down the slideshow
// loader (which would reset its zCounter, photo sequence, and place-anim).
let lastDetailFingerprint: string | null = null;

// Set when the selection came from the URL (deep link) and we still need to
// page-jump to it on the next render. Cleared after one render so subsequent
// user-driven paging isn't yanked back.
let pendingScrollToSelected = !!selectedUsername;

bonClientSubscribe((event) => {
  if (event.type === "reports-changed") {
    // Route through the poll path so non-structural writes (notes, lazy
    // profile-stat fills) don't tear down whichever widget the operator
    // is currently typing into. polling.pollNow does a full re-render
    // only when something actually changed structurally.
    void polling.pollNow();

    // Subreddit verdicts derive from per-user reports, so a fresh
    // user-investigation result shifts the badges on the Subreddits tab.
    void renderSubreddits();
  }

  if (event.type === "subreddits-changed") {
    void renderSubreddits();
  }

  if (event.type === "api-key-changed") {
    void bonSettingsRefreshApiKeyStatus();
  }
});

bonPageInitConfirmModal({ onConfirm: load });
bonQueuePauseInit({
  pauseEl: queuePauseEl,
  onChange: () => render(),
});
bonSettingsInit();
void bonPiiBlurInit();

const commandBar: BonPageCommandBarHandle = bonPageInitCommandBar({
  searchInput,
  agentFilterEl,
  agentFilterLabelEl,
  agentFilterClearBtn,
  getReports: () => allReports,
  onAgentFilterChange: () => {
    currentPage = 1;
    render();
  },
  onNavigateToUser: (username) => {
    selectedUsername = username;
    updateUrlForSelection();
    pendingScrollToSelected = true;
    render();
  },
  onCommandReload: async () => {
    currentPage = 1;
    await load();
  },
});

const tabs = bonPageInitTabs();

const polling = bonRedditorsInitPolling({
  getReports: () => allReports,
  setReports: (next) => {
    allReports = next;
  },
  onStructuralChange: () => {
    render();
    renderAnalytics();
    renderPersonas();
    renderSettingsStrip();
    void renderSubreddits();
  },
  setExpectedDurationMs: (value) => {
    expectedDurationMs = value;
  },
});

initStickyShellMeasurement();

bonRenderSync(syncContainer);

await load();

async function load(): Promise<void> {
  try {
    const { reports = {} } = await bonClientSend<{
      reports?: Record<string, Report>;
    }>({ type: "get-all-reports" });

    allReports = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));

    render();
    renderAnalytics();
    renderPersonas();
    renderSettingsStrip();
    void renderSubreddits();
  } catch (error) {
    console.error("[Bot or Not] failed to load reports", error);
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    renderLoadError(error);
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
  const hint = bonRedditorsDiagnoseLoadError(rawMessage);

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
// react to every poll tick — only when the underlying data actually changes.
function renderAnalytics(): void {
  if (!analyticsContainer) {
    return;
  }

  bonRenderAnalytics(allReports, analyticsContainer);
}

function renderPersonas(): void {
  if (!personasContainer) {
    return;
  }

  bonRenderPersonas(allReports, personasContainer, {
    onSelectUser: navigateToUser,
  });
}

async function renderSubreddits(): Promise<void> {
  await bonRenderSubreddits({
    listContainer: subredditsListEl,
    detailContainer: subredditsDetailEl,
    onSelectUser: navigateToUser,
  });
}

function navigateToUser(username: string): void {
  tabs.activate("redditors");
  selectedUsername = username;
  updateUrlForSelection();
  pendingScrollToSelected = true;
  render();
}

function renderSettingsStrip(): void {
  if (!settingsStripContainer) {
    return;
  }

  bonSettingsStrip(allReports, settingsStripContainer);
}

function render(): void {
  expectedDurationMs = bonExpectedDurationMs(allReports);
  commandBar.renderAgentFilterBanner();

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

  const agentFilter = commandBar.getAgentFilter();
  const filtered = agentFilter
    ? allReports.filter((report) => agentFilter.has(report.username))
    : allReports;

  const activeRows = filtered.filter(bonRedditorsIsActiveRow);
  const doneRows = filtered.filter(
    (report) => !bonRedditorsIsActiveRow(report)
  );

  activeRows.sort(bonRedditorsCompareActive);
  doneRows.sort(bonRedditorsCompareBy("investigatedAt", "desc", REGION_LABELS));

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
    polling.ensurePolling();
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
      currentPage = Math.floor(idx / BON_REDDITORS_PAGE_SIZE) + 1;
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil(doneRows.length / BON_REDDITORS_PAGE_SIZE)
  );

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  if (currentPage < 1) {
    currentPage = 1;
  }

  const pageStart = (currentPage - 1) * BON_REDDITORS_PAGE_SIZE;
  const pageEnd = pageStart + BON_REDDITORS_PAGE_SIZE;
  const pageRows = doneRows.slice(pageStart, pageEnd);

  for (const report of pageRows) {
    const summary = bonRedditorsRow(report, {
      selectedUsername,
      queueAhead: bonRedditorsCountQueuedAhead(allReports, report),
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
      bonPagination({
        currentPage,
        totalPages,
        totalItems: doneRows.length,
        pageSize: BON_REDDITORS_PAGE_SIZE,
        onPageChange: (next) => {
          currentPage = next;
          render();
        },
      })
    );
  }

  renderDetail();

  // Deep-link arrivals (URL ?user=, AI-command navigate) want the dossier
  // in view, not just the row. With the sticky shell holding the page
  // header, the row scroll alone leaves the detail pane below the fold on
  // narrow screens. Detail pane's scroll-margin-top already accounts for
  // the sticky shell height.
  if (shouldScrollToSelection) {
    detailPane.scrollIntoView({ block: "start" });
  }

  polling.ensurePolling();
}

function renderActiveSection(rows: ReportRow[]): void {
  const paused = bonQueuePauseIsActive();

  if (rows.length === 0 && !paused) {
    activeSection.hidden = true;
    return;
  }

  activeSection.hidden = false;

  if (rows.length === 0) {
    activeTitleEl.hidden = true;
    activeTitleEl.textContent = "";
    return;
  }

  activeTitleEl.hidden = false;

  let running = 0;
  let queued = 0;

  for (const row of rows) {
    if (row.investigation?.status === "running") {
      running += 1;
    } else if (row.investigation?.status === "queued") {
      queued += 1;
    }
  }

  // Only expose the running/queued split (and concurrency cap) when there's
  // queue pressure — otherwise the bare count is enough and the rows below
  // make the running-vs-queued status obvious.
  activeTitleEl.textContent =
    queued > 0
      ? `In progress · ${running} running · ${queued} queued (cap ${BON_INVESTIGATION_CONCURRENCY})`
      : `In progress · ${rows.length}`;

  for (const report of rows) {
    const summary = bonRedditorsRow(report, {
      selectedUsername,
      queueAhead: bonRedditorsCountQueuedAhead(allReports, report),
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
    BON_REDDITORS_URL_USER_PARAM
  );
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function updateUrlForSelection(): void {
  const params = new URLSearchParams(window.location.search);
  const current = params.get(BON_REDDITORS_URL_USER_PARAM);

  if (selectedUsername) {
    if (current === selectedUsername) {
      return;
    }

    params.set(BON_REDDITORS_URL_USER_PARAM, selectedUsername);
  } else {
    if (current === null) {
      return;
    }

    params.delete(BON_REDDITORS_URL_USER_PARAM);
  }

  const query = params.toString();
  const newUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState({}, "", newUrl);
}

function renderDetail(): void {
  let report: ReportRow | null = null;
  if (selectedUsername) {
    report =
      allReports.find((row) => row.username === selectedUsername) ?? null;

    if (!report) {
      selectedUsername = null;
    }
  }

  const queueAhead = report
    ? bonRedditorsCountQueuedAhead(allReports, report)
    : 0;

  const fingerprint = bonRedditorsDetailFingerprint(
    report,
    queueAhead,
    allReports.length > 0
  );

  if (fingerprint === lastDetailFingerprint) {
    return;
  }

  lastDetailFingerprint = fingerprint;

  detailPane.replaceChildren();

  if (!report) {
    detailPane.appendChild(
      bonRedditorsDetailEmpty(
        allReports.length === 0
          ? "No reports yet. Flag a Reddit user from their profile to start tracking."
          : "Select a user from the list to see the dossier."
      )
    );

    maybeAnimateDetailSwap();
    return;
  }

  detailPane.appendChild(
    bonRedditorsDetailPane(report, {
      expectedDurationMs,
      queueAhead,
      onNoApiKey: bonSettingsOpen,

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
  text.textContent = commandBar.getAgentFilter()
    ? "No reports match the active filter."
    : "No reports yet. Flag a Reddit user from their profile page to start tracking.";

  emptyEl.appendChild(text);
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
