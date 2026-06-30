// Reports-page orchestrator and Redditors-tab renderer. Owns the load +
// render loop and the page-level state (which row is selected, current
// page, expected duration). Tab activation, the AI command bar, and the
// confirm modal live in features/page/; settings UI in features/settings/;
// the polling loop and dossier widgets are siblings here. Sort order is
// fixed (most-recently-investigated first) so a fresh investigation always
// floats to the top.
//
// Entry point: redditorsRenderReportsPage() — called once from
// src/reports.ts when the page loads.

import { clientSend, clientSubscribe } from "../../client.ts";
import { renderAnalyticsTab } from "../analytics";
import { INVESTIGATION_CONCURRENCY } from "../investigation";
import { renderFieldGuideTab, renderPersonasTab } from "../personas";
import { renderSubredditsTab } from "../subreddits";
import { renderSync } from "../sync";
import { REGION_INFO } from "../regions";
import type { Report } from "../../types.ts";
import { computeExpectedDurationMs } from "../../utils/expected_duration.ts";
import { piiBlurInit } from "../../utils/pii_blur.ts";
import {
  pageInitCommandBar,
  pageInitConfirmModal,
  pageInitTabs,
  pageInstallDevBadge,
  type PageCommandBarHandle,
  type PageTab,
} from "../page";
import {
  settingsInit,
  settingsOpen,
  settingsRefreshApiKeyStatus,
  settingsStrip,
} from "../settings";
import { pagination } from "../../utils/pagination.ts";
import { redditorsInitPolling } from "./polling.ts";
import { redditorsDetailEmpty, redditorsDetailPane } from "./detail_pane.ts";
import { queuePauseInit, queuePauseIsActive } from "./queue_pause.ts";
import { redditorsRow } from "./table_row.ts";
import {
  redditorsCompareActive,
  redditorsCompareBy,
  redditorsCountQueuedAhead,
  redditorsDetailFingerprint,
  redditorsDiagnoseLoadError,
  redditorsIsActiveRow,
  type ReportRow,
} from "./logic.ts";

export async function redditorsRenderReportsPage(): Promise<void> {
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
  const queuePauseEl = document.getElementById(
    "bon-queue-pause"
  ) as HTMLElement;
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
  const fieldGuideContainer = document.getElementById(
    "bon-fieldguide-container"
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

  const REDDITORS_PAGE_SIZE = 20;
  const REDDITORS_URL_USER_PARAM = "user";

  // A burst enqueue (e.g. profiling a 100-user subreddit) makes the
  // in-progress table grow really tall and pushes the rest of the page
  // out of view. Show only the first N rows — the title still surfaces
  // the full running/queued counts.
  const ACTIVE_TABLE_VISIBLE_MAX = 10;

  // Vite inlines import.meta.env.DEV at build time, so the suffix only ships
  // in `vite dev` builds — published AMO builds (vite build) get a clean
  // version string.
  const versionEl = document.getElementById("bon-version");
  if (versionEl) {
    const version = browser.runtime.getManifest().version;
    versionEl.textContent = import.meta.env.DEV ? `${version} (dev)` : version;
  }

  pageInstallDevBadge();

  const REGION_LABELS: Record<string, string> = Object.fromEntries(
    Object.entries(REGION_INFO).map(([code, info]) => [code, info.label])
  );

  // The list, the active/queue table, and the polling loop run off lightweight
  // summaries (heavy per-record fields stripped server-side). The detail pane
  // and the heavy tabs need the full records, so those are fetched separately
  // and cached here, refreshed only when their tab is shown or the data
  // structurally changes.
  let allReports: ReportRow[] = [];
  let fullReports: ReportRow[] | null = null;
  let fullReportsDirty = true;

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

  clientSubscribe((event) => {
    if (event.type === "reports-changed") {
      // Route through the poll path so non-structural writes (notes, lazy
      // profile-stat fills) don't tear down whichever widget the operator
      // is currently typing into. polling.pollNow does a full re-render
      // only when something actually changed structurally — and that path
      // also refreshes the Subreddits tab, whose badges derive from per-user
      // verdicts, when it's the one on screen.
      void polling.pollNow();
    }

    if (event.type === "subreddits-changed") {
      if (tabs.current() === "subreddits") {
        void renderSubreddits();
      }
    }

    if (event.type === "api-key-changed") {
      void settingsRefreshApiKeyStatus();
    }
  });

  pageInitConfirmModal({ onConfirm: load });
  queuePauseInit({
    pauseEl: queuePauseEl,
    onChange: () => render(),
  });
  settingsInit();
  void piiBlurInit();

  const commandBar: PageCommandBarHandle = pageInitCommandBar({
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

  const tabs = pageInitTabs({
    onActivate: (tab) => {
      void renderHeavyTab(tab);
    },
  });

  const polling = redditorsInitPolling({
    getReports: () => allReports,
    setReports: (next) => {
      allReports = next;
    },
    onStructuralChange: () => {
      render();

      // The heavy tabs derive from the full records, which just went stale.
      // Refresh whichever one is on screen; the rest re-fetch when shown.
      fullReportsDirty = true;
      void renderHeavyTab(tabs.current());
    },
    setExpectedDurationMs: (value) => {
      expectedDurationMs = value;
    },
  });

  initStickyShellMeasurement();

  renderSync(syncContainer);

  await load();

  async function load(): Promise<void> {
    try {
      const { reports = {} } = await clientSend<{
        reports?: Record<string, Report>;
      }>({ type: "get-reports-summary" });

      allReports = Object.entries(reports).map(([username, data]) => ({
        username,
        ...data,
      }));

      fullReportsDirty = true;

      render();
      void renderHeavyTab(tabs.current());
    } catch (error) {
      console.error("[Bot or Not] failed to load reports", error);
      tableWrap.hidden = true;
      emptyEl.hidden = false;
      renderLoadError(error);
    }
  }

  // Full records (with the activity dumps, factor prose, and run snapshots the
  // list path drops) for the tabs that need them. Re-fetched only when the
  // cache is stale, so flipping between tabs is free until the data changes.
  async function ensureFullReports(): Promise<ReportRow[]> {
    if (fullReports && !fullReportsDirty) {
      return fullReports;
    }

    const { reports = {} } = await clientSend<{
      reports?: Record<string, Report>;
    }>({ type: "get-all-reports" });

    fullReports = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));
    fullReportsDirty = false;

    return fullReports;
  }

  // Render one tab's content on demand. The Redditors list is always live off
  // the summary path; every other tab is painted only while it's the one on
  // screen, so hundreds of records don't get projected into charts/scatter/SVG
  // on every poll tick behind a hidden panel.
  async function renderHeavyTab(tab: PageTab): Promise<void> {
    if (tab === "metrics") {
      const reports = await ensureFullReports();
      if (analyticsContainer) {
        renderAnalyticsTab(reports, analyticsContainer);
      }

      return;
    }

    if (tab === "personas") {
      const reports = await ensureFullReports();
      if (personasContainer) {
        renderPersonasTab(reports, personasContainer, {
          onSelectUser: navigateToUser,
        });
      }

      return;
    }

    if (tab === "fieldguide") {
      const reports = await ensureFullReports();
      renderFieldGuideTab(reports, fieldGuideContainer, {
        onSelectUser: navigateToUser,
      });

      return;
    }

    if (tab === "settings") {
      const reports = await ensureFullReports();
      if (settingsStripContainer) {
        settingsStrip(reports, settingsStripContainer);
      }

      return;
    }

    if (tab === "subreddits") {
      await renderSubreddits();
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
    const hint = redditorsDiagnoseLoadError(rawMessage);

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

  async function renderSubreddits(): Promise<void> {
    await renderSubredditsTab({
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

  function render(): void {
    expectedDurationMs = computeExpectedDurationMs(allReports);
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

    const activeRows = filtered.filter(redditorsIsActiveRow);
    const doneRows = filtered.filter((report) => !redditorsIsActiveRow(report));

    activeRows.sort(redditorsCompareActive);
    doneRows.sort(redditorsCompareBy("investigatedAt", "desc", REGION_LABELS));

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
        currentPage = Math.floor(idx / REDDITORS_PAGE_SIZE) + 1;
      }
    }

    const totalPages = Math.max(
      1,
      Math.ceil(doneRows.length / REDDITORS_PAGE_SIZE)
    );

    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    if (currentPage < 1) {
      currentPage = 1;
    }

    const pageStart = (currentPage - 1) * REDDITORS_PAGE_SIZE;
    const pageEnd = pageStart + REDDITORS_PAGE_SIZE;
    const pageRows = doneRows.slice(pageStart, pageEnd);

    for (const report of pageRows) {
      const summary = redditorsRow(report, {
        selectedUsername,
        queueAhead: redditorsCountQueuedAhead(allReports, report),
        onSelect: selectRow,
      });
      tbody.appendChild(summary);
    }

    tableWrap.hidden = doneRows.length === 0;

    const shouldScrollToSelection =
      pendingScrollToSelected && !!selectedUsername;

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
        pagination({
          currentPage,
          totalPages,
          totalItems: doneRows.length,
          pageSize: REDDITORS_PAGE_SIZE,
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
    const paused = queuePauseIsActive();

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
        ? `In progress · ${running} running · ${queued} queued (cap ${INVESTIGATION_CONCURRENCY})`
        : `In progress · ${rows.length}`;

    const visibleRows = rows.slice(0, ACTIVE_TABLE_VISIBLE_MAX);

    for (const report of visibleRows) {
      const summary = redditorsRow(report, {
        selectedUsername,
        queueAhead: redditorsCountQueuedAhead(allReports, report),
        onSelect: selectRow,
      });
      activeTbody.appendChild(summary);
    }

    const hiddenCount = rows.length - visibleRows.length;
    if (hiddenCount > 0) {
      const overflow = document.createElement("tr");
      overflow.className = "bon-active-overflow";
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent = `+${hiddenCount} more queued — will appear as slots free up`;
      overflow.appendChild(cell);
      activeTbody.appendChild(overflow);
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
      REDDITORS_URL_USER_PARAM
    );
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  }

  function updateUrlForSelection(): void {
    const params = new URLSearchParams(window.location.search);
    const current = params.get(REDDITORS_URL_USER_PARAM);

    if (selectedUsername) {
      if (current === selectedUsername) {
        return;
      }

      params.set(REDDITORS_URL_USER_PARAM, selectedUsername);
    } else {
      if (current === null) {
        return;
      }

      params.delete(REDDITORS_URL_USER_PARAM);
    }

    const query = params.toString();
    const newUrl = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }

  function renderDetail(): void {
    const report = selectedUsername
      ? (allReports.find((row) => row.username === selectedUsername) ?? null)
      : null;

    if (selectedUsername && !report) {
      selectedUsername = null;
    }

    const queueAhead = report
      ? redditorsCountQueuedAhead(allReports, report)
      : 0;

    const fingerprint = redditorsDetailFingerprint(
      report,
      queueAhead,
      allReports.length > 0
    );

    if (fingerprint === lastDetailFingerprint) {
      return;
    }

    lastDetailFingerprint = fingerprint;

    if (!report) {
      detailPane.replaceChildren();
      detailPane.appendChild(
        redditorsDetailEmpty(
          allReports.length === 0
            ? "No reports yet. Flag a Reddit user from their profile to start tracking."
            : "Select a user from the list to see the dossier."
        )
      );

      maybeAnimateDetailSwap();
      return;
    }

    void renderDetailPane(report.username, queueAhead);
  }

  // The list runs off slim summaries, so the dossier's heavy fields (activity
  // charts, factor breakdown, harvest dumps) come from a per-record fetch. The
  // summary already drove the fingerprint gate in renderDetail, so this runs
  // once per meaningful change, not on every poll tick. The old content stays
  // up until the fetch resolves to avoid an empty-pane flash on re-render.
  async function renderDetailPane(
    username: string,
    queueAhead: number
  ): Promise<void> {
    let full: Report | null = null;
    try {
      const response = await clientSend<{ report?: Report | null }>({
        type: "get-user-report",
        username,
      });
      full = response?.report ?? null;
    } catch (error) {
      console.error("[Bot or Not] failed to load dossier", error);
    }

    // The operator may have clicked another row while the fetch was in flight.
    if (selectedUsername !== username) {
      return;
    }

    const report: ReportRow | null = full
      ? { username, ...full }
      : (allReports.find((row) => row.username === username) ?? null);

    detailPane.replaceChildren();

    if (!report) {
      detailPane.appendChild(
        redditorsDetailEmpty("Select a user from the list to see the dossier.")
      );

      maybeAnimateDetailSwap();
      return;
    }

    detailPane.appendChild(
      redditorsDetailPane(report, {
        expectedDurationMs,
        queueAhead,
        onNoApiKey: settingsOpen,

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
}
