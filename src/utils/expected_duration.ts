// Median completed-run duration across the supplied reports. Drives the
// "{elapsed}s / ~{expected}s" treatment shown while an investigation is
// running. Returns null below 3 samples — not enough signal yet to predict
// against.

import type { Report } from "../types.ts";

export function computeExpectedDurationMs(
  reports: Iterable<Report>
): number | null {
  const durations: number[] = [];

  for (const report of reports) {
    const investigation = report.investigation;
    if (!investigation) {
      continue;
    }

    if (investigation.runs.length > 0) {
      for (const run of investigation.runs) {
        if (run.status === "done" && run.durationMs !== null) {
          durations.push(run.durationMs);
        }
      }
    } else if (
      investigation.status === "done" &&
      investigation.durationMs !== null
    ) {
      durations.push(investigation.durationMs);
    }
  }

  if (durations.length < 3) {
    return null;
  }

  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)]!;
}

export function expectedDurationSec(expectedMs: number): number {
  return Math.max(1, Math.round(expectedMs / 1000));
}
