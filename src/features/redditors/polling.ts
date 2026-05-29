// Drives the running-row "Xs / ~Ys" tick and the storage-onChanged-triggered
// full refresh. The 1Hz tick is local-only — it just rewrites text from the
// reports already in memory, so it costs nothing across the WebExtension
// boundary. State transitions arrive via storage.onChanged, which calls
// pollNow() once per write to re-pull the canonical set.

import { clientSend } from "../../client.ts";
import type { Report } from "../../types.ts";
import { computeExpectedDurationMs } from "../../utils/expected_duration.ts";
import { isInvestigationStale } from "../../verdict.ts";
import {
  redditorsFormatRunningCellText,
  redditorsFormatRunningTitle,
  redditorsHasStructuralChange,
  type ReportRow,
} from "./logic.ts";

const TICK_INTERVAL_MS = 1000;

export interface RedditorsPollingDeps {
  getReports(): ReportRow[];
  setReports(next: ReportRow[]): void;
  onStructuralChange(): void;
  setExpectedDurationMs(value: number | null): void;
}

export interface RedditorsPollingHandle {
  ensurePolling(): void;
  pollNow(): Promise<void>;
}

export function redditorsInitPolling(
  deps: RedditorsPollingDeps
): RedditorsPollingHandle {
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const ensurePolling = (): void => {
    const anyLive = deps.getReports().some((report) => {
      const status = report.investigation?.status;
      if (status === "queued") {
        return true;
      }

      return (
        status === "running" && !isInvestigationStale(report.investigation)
      );
    });

    if (anyLive && !tickTimer) {
      tickTimer = setInterval(tickLocal, TICK_INTERVAL_MS);
    } else if (!anyLive && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  // Local-only: no IPC, no storage read. Re-renders the elapsed-time text on
  // running rows from the in-memory reports. A stale "running" record will
  // start matching isInvestigationStale here and stop the timer on its own.
  const tickLocal = (): void => {
    updateRunningInPlace(deps.getReports(), deps.setExpectedDurationMs);
    ensurePolling();
  };

  const pollNow = async (): Promise<void> => {
    try {
      const { reports = {} } = await clientSend<{
        reports?: Record<string, Report>;
      }>({
        type: "get-all-reports",
      });

      const fresh: ReportRow[] = Object.entries(reports).map(
        ([username, data]) => ({
          username,
          ...data,
        })
      );

      const structuralChange = redditorsHasStructuralChange(
        deps.getReports(),
        fresh
      );
      deps.setReports(fresh);

      if (structuralChange) {
        deps.onStructuralChange();
      } else {
        updateRunningInPlace(deps.getReports(), deps.setExpectedDurationMs);
        ensurePolling();
      }
    } catch (error) {
      console.error("[Bot or Not] poll tick failed", error);
    }
  };

  return { ensurePolling, pollNow };
}

// In-place update of the running-row "Xs / ~Ys" buttons. Avoids re-rendering
// the row — re-rendering destroys the spinning button DOM and restarts its
// CSS animation, causing a visible jitter every tick.
function updateRunningInPlace(
  reports: ReportRow[],
  setExpectedDurationMs: (value: number | null) => void
): void {
  // Recompute in case a run completed between full renders and we have a
  // new sample for the median (no full re-render fires for that alone).
  const expectedDurationMs = computeExpectedDurationMs(reports);
  setExpectedDurationMs(expectedDurationMs);

  for (const report of reports) {
    const investigation = report.investigation;
    if (investigation?.status !== "running") {
      continue;
    }

    if (isInvestigationStale(investigation)) {
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

      button.textContent = redditorsFormatRunningCellText(
        elapsedSec,
        expectedDurationMs
      );
      button.title = redditorsFormatRunningTitle(
        elapsedSec,
        expectedDurationMs
      );
    }
  }
}
