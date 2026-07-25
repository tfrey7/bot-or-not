// Freshness predicate for harvested posts: a post is "fresh" when it was
// first captured after the most recent investigation ran, i.e. the verdict
// on file hasn't seen it yet. With lastRunAt == 0 (no investigation yet),
// everything counts as fresh.

import type { GoogleHarvest } from "../../types.ts";

export function googleHarvestCountFresh(
  harvest: GoogleHarvest | null,
  lastRunAt: number
): number {
  if (!harvest) {
    return 0;
  }

  let n = 0;

  for (const post of harvest.posts) {
    if (post.firstSeenAt > lastRunAt) {
      n++;
    }
  }

  return n;
}
