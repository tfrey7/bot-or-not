// Background-context handlers for passive-harvest messages. Lives in
// the feature dir (not redditors/handlers.ts) so dropping the directory
// also drops the storage writes — the message dispatch in
// background.ts is the only other touchpoint.

import type { Report } from "../../types.ts";
import { bonReadReports, bonWriteReports } from "../../storage.ts";
import { bonFindReportKey } from "../../utils/history.ts";
import { bonPassiveHarvestMerge } from "./merge.ts";
import type { BonPassiveHarvestFinding } from "./scrape.ts";

// Returns the lowercase usernames whose report.profileHidden is true,
// for the passive-harvest content script to scope its DOM scan by. Sent
// fresh on content-script load and again on every storage.onChanged for
// the `reports` key.
export async function bonPassiveHarvestGetHiddenUsernames(): Promise<{
  usernames: string[];
}> {
  const reports = await bonReadReports();
  const usernames: string[] = [];

  for (const [username, report] of Object.entries(reports)) {
    if (report.profileHidden) {
      usernames.push(username.toLowerCase());
    }
  }

  return { usernames };
}

// Merges a freshly-harvested batch onto the matching report's
// passiveHarvest. We don't create reports on this path the way Google
// harvest does — a content-script tick that surfaces a hidden user we
// don't have on file means our hidden-usernames set went out of sync
// (typically: report just got deleted). Silently drop.
export async function bonPassiveHarvestRecord(
  username: string,
  items: BonPassiveHarvestFinding["item"][]
): Promise<{ ok: boolean; itemCount?: number }> {
  const trimmed = username.trim();
  if (!trimmed || items.length === 0) {
    return { ok: false };
  }

  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, trimmed);
  if (!key) {
    return { ok: false };
  }

  const existing: Report = reports[key];
  if (!existing.profileHidden) {
    return { ok: false };
  }

  const merged = bonPassiveHarvestMerge({
    existing: existing.passiveHarvest,
    incoming: items,
    now: Date.now(),
  });

  reports[key] = { ...existing, passiveHarvest: merged };
  await bonWriteReports(reports);

  return { ok: true, itemCount: merged.items.length };
}
