// Redditors tab root component. Owns the summary list, selection, paging,
// and filter state; the page orchestrator (page.ts) mounts it once and
// talks to it through the handle. Reports live in a ref, not state — the
// polling loop rewrites running-row text in place every second, and only
// structural changes bump the version counter that triggers a re-render.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { clientSend, clientSubscribe } from "../../client.ts";
import type { Report } from "../../types.ts";
import { computeExpectedDurationMs } from "../../utils/expected_duration.ts";
import { pagination } from "../../utils/pagination.ts";
import { Vanilla } from "../../utils/vanilla.tsx";
import { pageInitCommandBar, type PageCommandBarHandle } from "../page";
import { REGION_INFO } from "../regions";
import { ActiveSection } from "./active_section.tsx";
import { DetailHost } from "./detail_host.tsx";
import {
  redditorsCompareActive,
  redditorsCompareBy,
  redditorsCountQueuedAhead,
  redditorsDiagnoseLoadError,
  redditorsIsActiveRow,
  redditorsIsSuspectedBot,
  type ReportRow,
} from "./logic.ts";
import { redditorsInitPolling } from "./polling.ts";
import { queuePauseInit, queuePauseIsActive } from "./queue_pause.ts";
import { RedditorsRow } from "./table_row.tsx";

const REDDITORS_PAGE_SIZE = 20;
const REDDITORS_URL_USER_PARAM = "user";

const REGION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_INFO).map(([code, info]) => [code, info.label])
);

export interface RedditorsTabHandle {
  navigateToUser(username: string): void;
  reload(): Promise<void>;
}

export interface RedditorsTabOptions {
  onStructuralChange(): void;
}

export function redditorsMountTab(
  container: HTMLElement,
  options: RedditorsTabOptions
): RedditorsTabHandle {
  const handle: RedditorsTabHandle = {
    navigateToUser: () => {},
    reload: async () => {},
  };

  render(
    <RedditorsTab
      handle={handle}
      onStructuralChange={options.onStructuralChange}
    />,
    container
  );

  return handle;
}

interface RedditorsTabProps {
  handle: RedditorsTabHandle;
  onStructuralChange(): void;
}

function RedditorsTab({ handle, onStructuralChange }: RedditorsTabProps) {
  const reportsRef = useRef<ReportRow[]>([]);
  const expectedDurationRef = useRef<number | null>(null);
  const commandBarRef = useRef<PageCommandBarHandle | null>(null);
  const pollingRef = useRef<ReturnType<typeof redditorsInitPolling> | null>(
    null
  );

  const [, setVersion] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(
    readSelectedUsernameFromUrl
  );
  const [botsOnly, setBotsOnly] = useState(false);
  const [agentFilter, setAgentFilter] = useState<ReadonlySet<string> | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // Set when the selection came from the URL (deep link) or another tab's
  // click and we still need to page-jump/scroll to it on the next render.
  const pendingScrollRef = useRef(selectedUsername !== null);

  const bumpVersion = (): void => {
    setVersion((version) => version + 1);
  };

  const load = async (): Promise<void> => {
    try {
      const { reports = {} } = await clientSend<{
        reports?: Record<string, Report>;
      }>({ type: "get-reports-summary" });

      reportsRef.current = Object.entries(reports).map(([username, data]) => ({
        username,
        ...data,
      }));

      setLoadError(null);
      bumpVersion();
      onStructuralChange();
    } catch (error) {
      console.error("[Bot or Not] failed to load reports", error);
      setLoadError(
        (error as { message?: string })?.message ||
          String(error) ||
          "Unknown error"
      );
    }
  };

  handle.navigateToUser = (username) => {
    setSelectedUsername(username);
    pendingScrollRef.current = true;
    bumpVersion();
  };

  handle.reload = load;

  useEffect(() => {
    pollingRef.current = redditorsInitPolling({
      getReports: () => reportsRef.current,
      setReports: (next) => {
        reportsRef.current = next;
      },
      onStructuralChange: () => {
        bumpVersion();
        onStructuralChange();
      },
      setExpectedDurationMs: (value) => {
        expectedDurationRef.current = value;
      },
    });

    commandBarRef.current = pageInitCommandBar({
      searchInput: document.getElementById("bon-search") as HTMLInputElement,
      agentFilterEl: document.getElementById("bon-agent-filter") as HTMLElement,
      agentFilterLabelEl: document.getElementById(
        "bon-agent-filter-label"
      ) as HTMLElement,
      agentFilterClearBtn: document.getElementById(
        "bon-agent-filter-clear"
      ) as HTMLButtonElement,
      getReports: () => reportsRef.current,
      onAgentFilterChange: () => {
        setCurrentPage(1);
        setAgentFilter(commandBarRef.current?.getAgentFilter() ?? null);
      },
      onNavigateToUser: (username) => {
        handle.navigateToUser(username);
      },
      onCommandReload: async () => {
        setCurrentPage(1);
        await load();
      },
    });

    queuePauseInit({
      pauseEl: document.getElementById("bon-queue-pause") as HTMLElement,
      onChange: bumpVersion,
    });

    const unsubscribe = clientSubscribe((event) => {
      if (event.type === "reports-changed") {
        // Route through the poll path so non-structural writes (notes, lazy
        // profile-stat fills) don't tear down whichever widget the operator
        // is currently typing into.
        void pollingRef.current?.pollNow();
      }
    });

    void load();

    return unsubscribe;
  }, []);

  // ---- Derived render data (mirrors the old render() pass) ----

  const allReports = reportsRef.current;
  expectedDurationRef.current = computeExpectedDurationMs(allReports);

  // URL deep-links pass the lowercased tag key as ?user=, but storage
  // preserves whatever case Reddit handed back. Resolve to the stored case
  // so the strict-equality checks below all succeed.
  let selected = selectedUsername;

  if (selected) {
    const canonical = allReports.find(
      (report) => report.username.toLowerCase() === selected!.toLowerCase()
    );

    if (canonical) {
      selected = canonical.username;
    }
  }

  const filtered = agentFilter
    ? allReports.filter((report) => agentFilter.has(report.username))
    : allReports;

  const activeRows = filtered.filter(redditorsIsActiveRow);
  const allDoneRows = filtered.filter(
    (report) => !redditorsIsActiveRow(report)
  );
  const doneRows = botsOnly
    ? allDoneRows.filter(redditorsIsSuspectedBot)
    : allDoneRows;

  activeRows.sort(redditorsCompareActive);
  doneRows.sort(redditorsCompareBy("investigatedAt", "desc", REGION_LABELS));

  const selectionListed =
    !!selected &&
    (activeRows.some((report) => report.username === selected) ||
      doneRows.some((report) => report.username === selected));
  const effectiveSelected = selectionListed ? selected : null;

  const selectedIsActive =
    !!effectiveSelected &&
    activeRows.some((report) => report.username === effectiveSelected);

  let page = currentPage;

  if (pendingScrollRef.current && effectiveSelected && !selectedIsActive) {
    const index = doneRows.findIndex(
      (report) => report.username === effectiveSelected
    );

    if (index >= 0) {
      page = Math.floor(index / REDDITORS_PAGE_SIZE) + 1;
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil(doneRows.length / REDDITORS_PAGE_SIZE)
  );
  page = Math.min(Math.max(1, page), totalPages);

  const pageStart = (page - 1) * REDDITORS_PAGE_SIZE;
  const pageRows = doneRows.slice(pageStart, pageStart + REDDITORS_PAGE_SIZE);

  const isEmpty = activeRows.length === 0 && doneRows.length === 0;

  const selectedRow = effectiveSelected
    ? (allReports.find((report) => report.username === effectiveSelected) ??
      null)
    : null;

  const selectRow = (username: string): void => {
    if (effectiveSelected === username) {
      return;
    }

    setSelectedUsername(username);

    // Bring the dossier top into view (scroll-margin-top on .bon-split-detail
    // leaves room for the sticky header). No-op if already in position.
    document
      .getElementById("bon-detail-pane")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Keep state and URL in sync with what was actually painted: canonical
  // username case, selections that fell out of the list, clamped pages.
  useEffect(() => {
    // A deep-link selection can't be validated until the first load lands —
    // reconciling here would strip ?user= before the reports arrive.
    const awaitingSelection = pendingScrollRef.current && !effectiveSelected;

    if (!awaitingSelection) {
      if (selectedUsername !== effectiveSelected) {
        setSelectedUsername(effectiveSelected);
      }

      writeSelectedUsernameToUrl(effectiveSelected);
    }

    if (currentPage !== page) {
      setCurrentPage(page);
    }
  });

  // Deep-link arrivals want both the row and the dossier in view.
  useEffect(() => {
    if (!pendingScrollRef.current) {
      return;
    }

    if (!effectiveSelected) {
      if (allReports.length > 0) {
        pendingScrollRef.current = false;
      }

      return;
    }

    pendingScrollRef.current = false;

    const scopeId = selectedIsActive ? "bon-tbody-active" : "bon-tbody";
    const row = document
      .getElementById(scopeId)
      ?.querySelector<HTMLTableRowElement>(
        `.bon-row-summary[data-bon-username="${CSS.escape(effectiveSelected)}"]`
      );
    row?.scrollIntoView({ block: "nearest" });

    document
      .getElementById("bon-detail-pane")
      ?.scrollIntoView({ block: "start" });
  });

  // The banner's count text derives from the freshly-painted list; the
  // polling timer only needs to run while something is queued or running.
  useEffect(() => {
    commandBarRef.current?.renderAgentFilterBanner();
    pollingRef.current?.ensurePolling();
  });

  return (
    <>
      <div class="bon-split-list">
        <ActiveSection
          rows={activeRows}
          allReports={allReports}
          selectedUsername={effectiveSelected}
          paused={queuePauseIsActive()}
          onSelect={selectRow}
        />
        <div class="bon-list-filter">
          <label class="bon-list-filter-toggle">
            <input
              type="checkbox"
              id="bon-bots-only"
              checked={botsOnly}
              onChange={(event) => {
                setBotsOnly(event.currentTarget.checked);
                setCurrentPage(1);
              }}
            />
            Suspected bots only
          </label>
        </div>
        <div
          class="bon-table-wrap"
          id="bon-table-wrap"
          hidden={doneRows.length === 0 || !!loadError}
        >
          <table class="bon-table" id="bon-table">
            <tbody id="bon-tbody">
              {pageRows.map((report) => (
                <RedditorsRow
                  key={report.username}
                  report={report}
                  selected={effectiveSelected === report.username}
                  queueAhead={redditorsCountQueuedAhead(allReports, report)}
                  onSelect={selectRow}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div id="bon-pagination-container">
          {totalPages > 1 && !loadError && (
            <Vanilla
              node={pagination({
                currentPage: page,
                totalPages,
                totalItems: doneRows.length,
                pageSize: REDDITORS_PAGE_SIZE,
                onPageChange: setCurrentPage,
              })}
            />
          )}
        </div>
        {loadError ? (
          <LoadError message={loadError} />
        ) : (
          isEmpty && <EmptyState botsOnly={botsOnly} filtered={!!agentFilter} />
        )}
      </div>
      <DetailHost
        selected={selectedRow}
        queueAhead={
          selectedRow ? redditorsCountQueuedAhead(allReports, selectedRow) : 0
        }
        hasAnyReports={allReports.length > 0}
        getExpectedDurationMs={() => expectedDurationRef.current}
        onInvestigate={() => {
          // Bounce back to page 1 — the fixed investigatedAt-desc sort will
          // float the freshly-kicked row to the top once the storage write
          // and re-render cycle lands.
          setCurrentPage(1);
        }}
      />
    </>
  );
}

function EmptyState({
  botsOnly,
  filtered,
}: {
  botsOnly: boolean;
  filtered: boolean;
}) {
  let text =
    "No reports yet. Flag a Reddit user from their profile page to start tracking.";

  if (botsOnly) {
    text = "No suspected bots among your reports.";
  } else if (filtered) {
    text = "No reports match the active filter.";
  }

  return (
    <div id="bon-empty" class="bon-empty">
      <p class="bon-empty-text">{text}</p>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  const hint = redditorsDiagnoseLoadError(message);

  return (
    <div id="bon-empty" class="bon-empty">
      <p class="bon-empty-text">Failed to load reports.</p>
      <p class="bon-empty-text bon-empty-detail">{message}</p>
      {hint && <p class="bon-empty-text bon-empty-hint">{hint}</p>}
      <button
        type="button"
        class="bon-btn bon-empty-action"
        onClick={() => location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

function readSelectedUsernameFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get(
    REDDITORS_URL_USER_PARAM
  );
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function writeSelectedUsernameToUrl(username: string | null): void {
  const params = new URLSearchParams(window.location.search);
  const current = params.get(REDDITORS_URL_USER_PARAM);

  if (username) {
    if (current === username) {
      return;
    }

    params.set(REDDITORS_URL_USER_PARAM, username);
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
