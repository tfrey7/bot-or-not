// Pure merge function for the per-user PassiveHarvest. Mirrors the
// GoogleHarvest merge: items union by canonical permalink, firstSeenAt
// is immutable on first capture, lastSeenAt refreshes every time the
// same permalink is observed again, and the aggregate
// subredditDistribution / kinds are recomputed each call so they can't
// drift from the items they're summarizing.
//
// Capped at PASSIVE_HARVEST_CAP items per user. When the cap is hit,
// the items with the oldest firstSeenAt are evicted first — they're the
// least likely to still be reachable from the operator's current
// browsing, and dropping them first keeps the dossier biased toward
// what's recently visible.

import type {
  PassiveHarvest,
  PassiveHarvestItem,
  PassiveHarvestItemKind,
} from "../../types.ts";
import type { PassiveHarvestFinding } from "./scrape.ts";

const PASSIVE_HARVEST_CAP = 100;

function canonicalizePermalink(permalink: string): string {
  return permalink.split("#")[0].split("?")[0].replace(/\/$/, "");
}

function mergeItem(
  existing: PassiveHarvestItem | undefined,
  incoming: PassiveHarvestFinding["item"],
  now: number
): PassiveHarvestItem {
  if (existing) {
    // Body excerpt / title can change if the user edited the post or
    // Reddit re-rendered with a different excerpt — take the new value.
    // createdAt should never change once stamped; only fill it if we
    // didn't have one before.
    return {
      ...existing,
      kind: incoming.kind,
      subreddit: incoming.subreddit ?? existing.subreddit,
      postTitle: incoming.postTitle ?? existing.postTitle,
      bodyExcerpt: incoming.bodyExcerpt || existing.bodyExcerpt,
      createdAt: existing.createdAt ?? incoming.createdAt,
      lastSeenAt: now,
    };
  }

  return {
    ...incoming,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

function computeAggregates(items: PassiveHarvestItem[]): {
  subredditDistribution: Record<string, number>;
  kinds: Record<PassiveHarvestItemKind, number>;
} {
  const subredditDistribution: Record<string, number> = {};
  const kinds: Record<PassiveHarvestItemKind, number> = { post: 0, comment: 0 };

  for (const item of items) {
    kinds[item.kind] += 1;
    if (item.subreddit) {
      subredditDistribution[item.subreddit] =
        (subredditDistribution[item.subreddit] || 0) + 1;
    }
  }

  return { subredditDistribution, kinds };
}

export interface PassiveHarvestMergeInput {
  existing: PassiveHarvest | null;
  incoming: PassiveHarvestFinding["item"][];
  now: number;
}

export function passiveHarvestMerge(
  input: PassiveHarvestMergeInput
): PassiveHarvest {
  const { existing, incoming, now } = input;

  const byPermalink = new Map<string, PassiveHarvestItem>();

  for (const item of existing?.items ?? []) {
    byPermalink.set(canonicalizePermalink(item.permalink), item);
  }

  for (const item of incoming) {
    const key = canonicalizePermalink(item.permalink);
    byPermalink.set(key, mergeItem(byPermalink.get(key), item, now));
  }

  let items = Array.from(byPermalink.values());

  if (items.length > PASSIVE_HARVEST_CAP) {
    items = items
      .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
      .slice(0, PASSIVE_HARVEST_CAP);
  }

  const aggregates = computeAggregates(items);

  return {
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    captureCount: (existing?.captureCount ?? 0) + 1,
    items,
    ...aggregates,
  };
}
