// Reports-page orchestrator. Owns the load / render / poll loop, the
// search input, the sort header click handlers, the analytics container,
// and the two modals (confirm + settings). Each row + cell renderer
// lives in its own file in this directory; this file just wires them
// together.

import { bonRenderAnalytics } from "../analytics";
import { BON_REGION_INFO } from "../regions/data.ts";
import type { Report } from "../../types.ts";
import { bonIsInvestigationStale } from "../../verdict.ts";
import { bonReportsApplyProgressVisual } from "./cell_actions.ts";
import {
  bonReportsCloseModalsOnEscape,
  bonReportsInitConfirmModal,
  bonReportsInitSettingsModal,
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
const analyticsContainer = document.getElementById(
  "bon-analytics-container"
) as HTMLElement | null;
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

searchInput.addEventListener("input", render);

bonReportsInitConfirmModal({ onConfirm: load });
bonReportsInitSettingsModal();
bonReportsCloseModalsOnEscape();

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

function render(): void {
  expectedDurationMs = bonReportsExpectedDurationMs(allReports);
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

  if (filtered.length === 0) {
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    renderEmptyState(query);
    ensurePolling();
    return;
  }

  tableWrap.hidden = false;
  emptyEl.hidden = true;

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
    try {
      const response = (await browser.runtime.sendMessage({
        type: "investigate-user",
        username,
      })) as { ok?: boolean; error?: string };

      if (response?.ok === false && response.error === "no-api-key") {
        hasApiKey = false;
        render();
        return;
      }

      searchInput.value = "";
      sortKey = "investigatedAt";
      sortDir = "desc";
      updateSortIndicators();
      render();
    } catch (error) {
      console.error("[Bot or Not] manual investigate failed", error);
      investigateButton.disabled = false;
      investigateButton.textContent = `Investigate u/${username}`;
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

    const elapsedMs = Math.max(0, Date.now() - investigation.startedAt);
    const elapsedSec = Math.round(elapsedMs / 1000);

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

    const buttons = tbody.querySelectorAll<HTMLButtonElement>(
      "[data-bon-running-btn]"
    );
    for (const button of buttons) {
      if (button.dataset.bonRunningBtn !== report.username) {
        continue;
      }
      button.title = bonReportsFormatRunningTitle(
        elapsedSec,
        expectedDurationMs
      );
      if (button.classList.contains("bon-progress") && expectedDurationMs) {
        bonReportsApplyProgressVisual(button, elapsedMs, expectedDurationMs);
      }
    }
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
