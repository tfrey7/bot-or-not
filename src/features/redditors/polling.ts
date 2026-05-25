// Polling loop for in-flight investigations. While anything is queued or
// running, fetch fresh data every second and either do a full re-render
// (structural change) or an in-place tick of the running-row buttons.
// storage.onChanged should cover transitions but doesn't always fire
// reliably across extension pages, so polling is the source of truth.

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

const POLL_INTERVAL_MS = 1000;

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
  let pollTimer: ReturnType<typeof setInterval> | null = null;

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

    if (anyLive && !pollTimer) {
      pollTimer = setInterval(pollNow, POLL_INTERVAL_MS);
    } else if (!anyLive && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
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
