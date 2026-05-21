// Subreddit-based region signal: a user who regularly posts/comments in
// country-coded subs (r/india, r/pakistan, r/brasil, …) is almost always
// from that country. Strong signal; multiple country subs only nudge the
// score, not multiply it.

import { BON_REGION_SUB_PATTERNS, BON_REGION_SUBS } from "./data.ts";

export function bonNormalizeSubName(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
}

// Resolves a normalized sub name to a region code. Exact match first (the
// curated table in data.ts is the canonical truth); falls back to regex
// patterns for the long tail (r/indian_*, r/pakistani_*, …). Also used by
// moderated.ts to score moderator-of-region signal.
export function bonRegionsLookupSub(normalizedSub: string): string | undefined {
  if (!normalizedSub) {
    return undefined;
  }

  const exact = BON_REGION_SUBS[normalizedSub];
  if (exact) {
    return exact;
  }

  for (const { pattern, region } of BON_REGION_SUB_PATTERNS) {
    if (pattern.test(normalizedSub)) {
      return region;
    }
  }

  return undefined;
}

export interface SubRegionHit {
  sub: string;
  count: number;
}

export interface SubregionInference {
  region: string;
  count: number;
  totalFlagged: number;
  share: number;
  hits: SubRegionHit[];
  runnerUp: { region: string; count: number } | null;
}

// Returns null if no flagged subs touched, otherwise:
//   { region, count, totalFlagged, share, hits, runnerUp }
// where hits is the per-sub breakdown for the top region, sorted.
export function bonInferRegionFromSubreddits(
  subredditCounts: Record<string, number> | null | undefined
): SubregionInference | null {
  if (!subredditCounts) {
    return null;
  }

  const totals: Record<string, number> = Object.create(null);
  const hitsByRegion: Record<string, SubRegionHit[]> = Object.create(null);
  let totalFlagged = 0;

  for (const [sub, count] of Object.entries(subredditCounts)) {
    if (!count) {
      continue;
    }

    const region = bonRegionsLookupSub(bonNormalizeSubName(sub));
    if (!region) {
      continue;
    }

    totals[region] = (totals[region] || 0) + count;
    (hitsByRegion[region] = hitsByRegion[region] || []).push({ sub, count });
    totalFlagged += count;
  }

  if (totalFlagged === 0) {
    return null;
  }

  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const [topRegion, topCount] = ranked[0];

  const runnerUp = ranked[1]
    ? { region: ranked[1][0], count: ranked[1][1] }
    : null;

  return {
    region: topRegion,
    count: topCount,
    totalFlagged,
    share: topCount / totalFlagged,
    hits: hitsByRegion[topRegion].sort((a, b) => b.count - a.count),
    runnerUp,
  };
}
