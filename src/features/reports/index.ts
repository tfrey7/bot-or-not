// Reports-page orchestrator. Owns the load / render / poll loop, the
// search input, the sort header click handlers, the analytics container,
// and the two modals (confirm + settings). Each row + cell renderer
// lives in its own file in this directory; this file just wires them
// together.

import { bonRenderAnalytics } from "../analytics/index.ts";
import { BON_REGION_INFO } from "../regions/data.ts";
import type { Report } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsApplyProgressVisual } from "./cell_actions.ts";
import {
  bonReportsCloseModalsOnEscape,
  bonReportsInitConfirmModal,
  bonReportsInitSettingsModal,
  bonReportsOpenConfirmModal,
  bonReportsOpenSettings,
} from "./modals.ts";
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
const searchInput = document.getElementById("bon-search") as HTMLInputElement;
const clearBtn = document.getElementById("bon-clear-btn") as HTMLButtonElement;
const analyticsContainer = document.getElementById(
  "bon-analytics-container"
) as HTMLElement | null;

const REGION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(BON_REGION_INFO).map(([code, info]) => [code, info.label])
);

let allReports: ReportRow[] = [];
// Median duration across all completed runs. Drives the progress ring and
// "~Xs left" countdown on in-flight investigations. Recomputed before
// render and before each poll tick. Null until we have ≥3 completed runs.
let expectedDurationMs: number | null = null;
let sortKey: SortKey = "investigatedAt";
let sortDir: SortDir = "desc";
const expanded = new Set<string>();
const inflightActivity = new Set<string>();

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
  } catch (err) {
    console.error("[Bot or Not] auto-load activity failed", err);
  } finally {
    inflightActivity.delete(username);
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.reports) {
    void load();
  }
});

searchInput.addEventListener("input", render);

clearBtn.addEventListener("click", () => {
  bonReportsOpenConfirmModal({
    text: "Clear all reported users? This can't be undone.",
    confirmLabel: "Clear all",
    action: () => browser.runtime.sendMessage({ type: "clear-all-reports" }),
  });
});

bonReportsInitConfirmModal({ onConfirm: load });
bonReportsInitSettingsModal();
bonReportsCloseModalsOnEscape();

document
  .querySelectorAll<HTMLTableCellElement>("th.bon-sortable")
  .forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort as SortKey | undefined;
      if (!key) {
        return;
      }

      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir =
          (th.dataset.defaultDir as SortDir) || bonReportsDefaultDirFor(key);
      }

      render();
    });
  });

await load();

async function load(): Promise<void> {
  try {
    const { reports = {} } = (await browser.runtime.sendMessage({
      type: "get-all-reports",
    })) as { reports?: Record<string, Report> };

    allReports = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));

    render();
    renderAnalytics();
  } catch (err) {
    console.error("[Bot or Not] failed to load reports", err);
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    renderLoadError(err);
  }
}

function renderLoadError(err: unknown): void {
  emptyEl.replaceChildren();

  const heading = document.createElement("p");
  heading.className = "bon-empty-text";
  heading.textContent = "Failed to load reports.";
  emptyEl.appendChild(heading);

  const rawMessage =
    (err as { message?: string })?.message || String(err) || "Unknown error";
  const hint = bonReportsDiagnoseLoadError(rawMessage);

  const detail = document.createElement("p");
  detail.className = "bon-empty-text bon-empty-detail";
  detail.textContent = rawMessage;
  emptyEl.appendChild(detail);

  if (hint) {
    const hintEl = document.createElement("p");
    hintEl.className = "bon-empty-text bon-empty-hint";
    hintEl.textContent = hint;
    emptyEl.appendChild(hintEl);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bon-btn bon-empty-action";
  btn.textContent = "Reload page";

  btn.addEventListener("click", () => {
    location.reload();
  });

  emptyEl.appendChild(btn);
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

function render(): void {
  expectedDurationMs = bonReportsExpectedDurationMs(allReports);
  const query = searchInput.value.trim().toLowerCase();

  const filtered = allReports.filter((r) => {
    if (!query) {
      return true;
    }

    const haystack = [
      r.username,
      ...(r.history || []).flatMap((h) => [
        h.subreddit,
        h.postTitle as string | undefined,
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

  if (filtered.length === 0) {
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    renderEmptyState(query);
    clearBtn.hidden = allReports.length === 0;
    ensurePolling();
    return;
  }

  tableWrap.hidden = false;
  emptyEl.hidden = true;
  clearBtn.hidden = false;

  for (const report of filtered) {
    const { summary, detailRows } = bonReportsRow(report, {
      expanded,
      expectedDurationMs,
      inflightActivity,
      onNoApiKey: bonReportsOpenSettings,
      onActivityNeedsLoad: loadActivityIfStale,
    });
    tbody.appendChild(summary);
    for (const row of detailRows) {
      tbody.appendChild(row);
    }
  }

  ensurePolling();
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

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bon-btn bon-empty-action";
  btn.textContent = `Investigate u/${username}`;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Starting…";
    try {
      void browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      });
      searchInput.value = "";
      sortKey = "investigatedAt";
      sortDir = "desc";
      updateSortIndicators();
      render();
    } catch (err) {
      console.error("[Bot or Not] manual investigate failed", err);
      btn.disabled = false;
      btn.textContent = `Investigate u/${username}`;
    }
  });

  emptyEl.appendChild(btn);
}

function ensurePolling(): void {
  const anyLive = allReports.some(
    (r) =>
      r.investigation?.status === "running" &&
      !bonIsInvestigationStale(r.investigation)
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
    } else {
      updateRunningInPlace();
      ensurePolling();
    }
  } catch (err) {
    console.error("[Bot or Not] poll tick failed", err);
  }
}

function updateRunningInPlace(): void {
  // Recompute in case a run completed between full renders and we have a
  // new sample for the median (no full re-render fires for that alone).
  expectedDurationMs = bonReportsExpectedDurationMs(allReports);

  for (const r of allReports) {
    const inv = r.investigation;
    if (inv?.status !== "running") {
      continue;
    }
    if (bonIsInvestigationStale(inv)) {
      continue;
    }
    if (!inv.startedAt) {
      continue;
    }

    const elapsedMs = Math.max(0, Date.now() - inv.startedAt);
    const elapsedSec = Math.round(elapsedMs / 1000);

    const cells = tbody.querySelectorAll<HTMLTableCellElement>(
      "[data-bon-running-cell]"
    );
    for (const cell of cells) {
      if (cell.dataset.bonRunningCell === r.username) {
        cell.textContent = bonReportsFormatRunningCellText(
          elapsedSec,
          expectedDurationMs
        );
      }
    }

    const btns = tbody.querySelectorAll<HTMLButtonElement>(
      "[data-bon-running-btn]"
    );
    for (const btn of btns) {
      if (btn.dataset.bonRunningBtn !== r.username) {
        continue;
      }
      btn.title = bonReportsFormatRunningTitle(elapsedSec, expectedDurationMs);
      if (btn.classList.contains("bon-progress") && expectedDurationMs) {
        bonReportsApplyProgressVisual(btn, elapsedMs, expectedDurationMs);
      }
    }
  }
}

function updateSortIndicators(): void {
  document
    .querySelectorAll<HTMLTableCellElement>("th.bon-sortable")
    .forEach((th) => {
      const indicator = th.querySelector(".bon-sort-indicator");
      if (!indicator) {
        return;
      }

      if (th.dataset.sort === sortKey) {
        indicator.textContent = sortDir === "asc" ? "▲" : "▼";
      } else {
        indicator.textContent = "";
      }
    });
}
