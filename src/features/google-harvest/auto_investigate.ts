// Auto-runs the investigation once a Google-harvest session goes quiet:
// every captured batch re-arms a per-user alarm, and when it fires with no
// further captures having reset it, the investigation starts without the
// operator having to click re-run.
//
// Alarms rather than setTimeout because Firefox suspends the MV3 event
// page after ~30s of idle — exactly the quiet window being measured. All
// fire-time decisions are read from storage, so a fire that wakes a fresh
// worker is still correct; a browser restart or extension reload clears
// pending alarms, which just drops the trigger back to the manual path.

import { readReport } from "../../storage";
import { investigationResults } from "../../utils/history.ts";
import { investigationStart } from "../investigation";
import { googleHarvestCountFresh } from "./freshness.ts";

const ALARM_PREFIX = "bon-auto-investigate:";

// Firefox honors sub-minute alarms — the 30s floor in MDN's notes is
// Chrome-only.
const QUIET_WINDOW_MINUTES = 0.5;

// Re-armed on every capture, including all-duplicate ones: the operator is
// still paging through results, so the quiet clock keeps resetting. Whether
// anything actually runs is decided at fire time, not here.
export function googleHarvestAutoInvestigateSchedule(username: string): void {
  browser.alarms.create(ALARM_PREFIX + username, {
    delayInMinutes: QUIET_WINDOW_MINUTES,
  });
}

export function googleHarvestAutoInvestigateOnAlarm(
  alarm: browser.alarms.Alarm
): void {
  if (!alarm.name.startsWith(ALARM_PREFIX)) {
    return;
  }

  void autoInvestigate(alarm.name.slice(ALARM_PREFIX.length));
}

async function autoInvestigate(username: string): Promise<void> {
  try {
    const report = await readReport(username);
    if (!report?.googleHarvest) {
      return;
    }

    // Something already queued/running — the operator (or another trigger)
    // beat us to it. Don't pile a second run on.
    const investigation = report.investigation;
    if (
      investigation?.status === "queued" ||
      investigation?.status === "running"
    ) {
      return;
    }

    // Same definition as the reports page's "new since last analysis"
    // badge — a re-browse of an already-harvested search adds nothing and
    // must not burn another run.
    const lastRunAt = investigationResults(investigation)?.runAt ?? 0;
    const freshCount = googleHarvestCountFresh(report.googleHarvest, lastRunAt);
    if (freshCount === 0) {
      return;
    }

    console.log(
      `[Bot or Not] google-harvest: quiet — auto-running investigation for u/${username} (${freshCount} new post(s))`
    );

    const result = await investigationStart(username, true);
    if (!result.ok) {
      console.warn(
        `[Bot or Not] google-harvest: auto-run for u/${username} failed: ${result.error}`
      );
    }
  } catch (error) {
    console.error("[Bot or Not] google-harvest auto-run failed", error);
  }
}
