// Background-only orchestration for automatic sync: the periodic pull alarm,
// the debounced push-on-local-change, and the startup reconcile. All triggers
// funnel through runReconcile, which serializes cycles and — via the module
// `reconciling` flag — keeps a reconcile's own bulk report write (which fires
// storage.onChanged) from re-triggering the change listener into a loop.

import { readSyncConfig } from "../../storage";
import { syncReconcile } from "./remote.ts";
import type { MergeStats } from "./logic.ts";

const ALARM_NAME = "bon-sync-pull";
const ALARM_PERIOD_MINUTES = 5;
const CHANGE_DEBOUNCE_MS = 10_000;
const REPORT_KEY_PREFIX = "report:";

let reconciling = false;
let pendingChange = false;
let syncEnabled = false;
let changeTimer: ReturnType<typeof setTimeout> | null = null;

export async function runReconcile(reason: string): Promise<MergeStats> {
  if (reconciling) {
    throw new Error("A sync is already in progress.");
  }

  reconciling = true;

  try {
    const stats = await syncReconcile();
    console.log(
      `[Bot or Not] sync (${reason}): ${stats.added.length} added, ${stats.merged.length} merged`
    );

    return stats;
  } finally {
    reconciling = false;

    // A report change that landed mid-cycle missed this cycle's merge; re-arm
    // the debounce instead of letting it wait for the next alarm. The cycle's
    // own write can trip this too — that follow-up reconcile no-op-merges and
    // stops, so it costs one round-trip, not a loop.
    if (pendingChange) {
      pendingChange = false;
      armChangeTimer();
    }
  }
}

async function safeReconcile(reason: string): Promise<void> {
  if (reconciling) {
    return;
  }

  try {
    await runReconcile(reason);
  } catch (error) {
    console.error(`[Bot or Not] sync (${reason}) failed`, error);
  }
}

// Creates or clears the periodic pull alarm to match the enabled flag, and
// caches that flag so the storage listener can bail cheaply without an async
// read on every write.
export async function syncSetupAlarm(): Promise<void> {
  const config = await readSyncConfig();
  syncEnabled = config.enabled;

  if (config.enabled) {
    browser.alarms.create(ALARM_NAME, {
      periodInMinutes: ALARM_PERIOD_MINUTES,
    });
  } else {
    await browser.alarms.clear(ALARM_NAME);
  }
}

export async function syncBackgroundInit(): Promise<void> {
  await syncSetupAlarm();

  if (syncEnabled) {
    void safeReconcile("startup");
  }
}

export function syncOnAlarm(alarm: browser.alarms.Alarm): void {
  if (alarm.name !== ALARM_NAME) {
    return;
  }

  void safeReconcile("alarm");
}

export function syncHandleStorageChange(
  changes: Record<string, browser.storage.StorageChange>,
  areaName: string
): void {
  if (areaName !== "local" || !syncEnabled) {
    return;
  }

  const touchedReport = Object.keys(changes).some((key) =>
    key.startsWith(REPORT_KEY_PREFIX)
  );

  if (!touchedReport) {
    return;
  }

  if (reconciling) {
    pendingChange = true;
    return;
  }

  armChangeTimer();
}

function armChangeTimer(): void {
  if (changeTimer) {
    clearTimeout(changeTimer);
  }

  changeTimer = setTimeout(() => {
    changeTimer = null;
    void safeReconcile("local-change");
  }, CHANGE_DEBOUNCE_MS);
}
