// Moderator-of-region signal: anyone trusted to moderate a country sub is
// overwhelmingly from that country. Strongest per-hit signal we have —
// shares the sub→region lookup machinery with the subreddit inference.

import { normalizeSubName, regionsLookupSub } from "./subreddit.ts";

export interface ModeratedInference {
  region: string;
  score: number;
  hits: Array<{ sub: string; region: string }>;
}

export function inferRegionFromModerated(
  moderatedSubs: string[] | null | undefined
): ModeratedInference | null {
  if (!Array.isArray(moderatedSubs) || moderatedSubs.length === 0) {
    return null;
  }

  const votes: Record<string, number> = {};
  const hits: ModeratedInference["hits"] = [];

  for (const sub of moderatedSubs) {
    const region = regionsLookupSub(normalizeSubName(sub));
    if (!region) {
      continue;
    }

    votes[region] = (votes[region] || 0) + 1;
    hits.push({ sub, region });
  }

  if (Object.keys(votes).length === 0) {
    return null;
  }

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return { region: ranked[0][0], score: ranked[0][1], hits };
}
