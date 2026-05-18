// Reports-page orchestrator. Owns the load / render / poll loop, the
// search input, the sort header click handlers, the analytics container,
// and the two modals (confirm + settings). Each row + cell renderer
// lives in its own file in this directory; this file just wires them
// together.

import { bonRenderAnalytics } from "../analytics/index.js";
import { BON_REGION_INFO } from "../regions/data.js";
import { bonReportsApplyProgressVisual } from "./cell_actions.js";
import {
  bonReportsCloseModalsOnEscape,
  bonReportsInitConfirmModal,
  bonReportsInitSettingsModal,
  bonReportsOpenConfirmModal,
  bonReportsOpenSettings,
} from "./modals.js";
import { bonReportsRow } from "./table_row.js";
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
} from "./logic.js";
import { bonIsInvestigationStale } from "../../verdict.js";

const tbody = document.getElementById("bon-tbody");
const tableWrap = document.getElementById("bon-table-wrap");
const emptyEl = document.getElementById("bon-empty");
const searchInput = document.getElementById("bon-search");
const clearBtn = document.getElementById("bon-clear-btn");
const analyticsContainer = document.getElementById("bon-analytics-container");

const REGION_LABELS = Object.fromEntries(
  Object.entries(BON_REGION_INFO).map(([code, info]) => [code, info.label])
);

let allReports = [];
// Median duration across all completed runs. Drives the progress ring and
// "~Xs left" countdown on in-flight investigations. Recomputed before
// render and before each poll tick. Null until we have ≥3 completed runs.
let expectedDurationMs = null;
let sortKey = "investigatedAt";
let sortDir = "desc";
const expanded = new Set();
const inflightActivity = new Set();

// While any investigation is "running", poll storage so the elapsed timer
// ticks and completion/error transitions land without a manual refresh.
// storage.onChanged should cover the transitions but doesn't always fire
// reliably across extension pages, so the poll is the source of truth.
let pollTimer = null;
const POLL_INTERVAL_MS = 1000;

async function loadActivityIfStale(username, activityData) {
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

document.querySelectorAll("th.bon-sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = th.dataset.defaultDir || bonReportsDefaultDirFor(key);
    }
    render();
  });
});

await load();

async function load() {
  try {
    const { reports = {} } = await browser.runtime.sendMessage({
      type: "get-all-reports",
    });
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

function renderLoadError(err) {
  emptyEl.replaceChildren();

  const heading = document.createElement("p");
  heading.className = "bon-empty-text";
  heading.textContent = "Failed to load reports.";
  emptyEl.appendChild(heading);

  const rawMessage = err?.message || String(err) || "Unknown error";
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
function renderAnalytics() {
  if (!analyticsContainer) {
    return;
  }
  bonRenderAnalytics(allReports, analyticsContainer);
}

function render() {
  expectedDurationMs = bonReportsExpectedDurationMs(allReports);
  const query = searchInput.value.trim().toLowerCase();

  const filtered = allReports.filter((r) => {
    if (!query) {
      return true;
    }
    const haystack = [
      r.username,
      ...(r.history || []).flatMap((h) => [h.subreddit, h.postTitle]),
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

function renderEmptyState(query) {
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

function ensurePolling() {
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
async function pollTick() {
  try {
    const { reports = {} } = await browser.runtime.sendMessage({
      type: "get-all-reports",
    });
    const fresh = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));
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

function updateRunningInPlace() {
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
    const cells = tbody.querySelectorAll("[data-bon-running-cell]");
    for (const cell of cells) {
      if (cell.dataset.bonRunningCell === r.username) {
        cell.textContent = bonReportsFormatRunningCellText(
          elapsedSec,
          expectedDurationMs
        );
      }
    }
    const btns = tbody.querySelectorAll("[data-bon-running-btn]");
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

function updateSortIndicators() {
  document.querySelectorAll("th.bon-sortable").forEach((th) => {
    const indicator = th.querySelector(".bon-sort-indicator");
    if (th.dataset.sort === sortKey) {
      indicator.textContent = sortDir === "asc" ? "▲" : "▼";
    } else {
      indicator.textContent = "";
    }
  });
}
