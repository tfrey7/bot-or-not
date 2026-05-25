// Background-context handlers for passive-harvest messages. Lives in
// the feature dir (not redditors/handlers.ts) so dropping the directory
// also drops the storage writes — the message dispatch in
// background.ts is the only other touchpoint.

import { bonReadReports, bonUpdateReport } from "../../storage.ts";
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

  let mergedItemCount: number | null = null;

  await bonUpdateReport(trimmed, (current) => {
    if (!current?.profileHidden) {
      return current;
    }

    const merged = bonPassiveHarvestMerge({
      existing: current.passiveHarvest,
      incoming: items,
      now: Date.now(),
    });

    mergedItemCount = merged.items.length;
    return { ...current, passiveHarvest: merged };
  });

  if (mergedItemCount === null) {
    return { ok: false };
  }

  return { ok: true, itemCount: mergedItemCount };
}
