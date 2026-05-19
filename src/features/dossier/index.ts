// Background-side entry points for the per-user context dossier.
//   bonDossierAdd      — fetch + dedup + persist a single permalink
//   bonDossierRemove   — strip an item by permalink
//   bonDossierHasMap   — bulk presence check (one round-trip hydrates many
//                        in-page buttons)
//
// All storage I/O stays inside this module so the rest of the codebase only
// touches dossiers via these helpers.

import type { ContextItem } from "../../types.ts";
import {
  bonFindReportKey,
  bonNormalizeReport,
  bonReadReports,
  bonWriteReports,
} from "../../utils/history.ts";
import { bonFetchContextItem, bonNormalizePermalink } from "./fetch.ts";

export type { ContextItem };

export interface DossierAddResult {
  ok: boolean;
  added: boolean;
  item?: ContextItem;
  error?: string;
}

export async function bonDossierAdd(
  username: string,
  permalink: string,
  provenance: "auto" | "manual"
): Promise<DossierAddResult> {
  if (!username || !permalink) {
    return { ok: false, added: false, error: "missing-args" };
  }

  const path = bonNormalizePermalink(permalink);
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username) ?? username;
  const existing = reports[key] ?? bonNormalizeReport(undefined);

  if (existing.contextItems.some((item) => item.permalink === path)) {
    return { ok: true, added: false };
  }

  let item: ContextItem;
  try {
    item = await bonFetchContextItem(path, provenance);
  } catch (error) {
    console.error("[Bot or Not] dossier fetch failed", error);
    return {
      ok: false,
      added: false,
      error: String((error as { message?: string })?.message ?? error),
    };
  }

  const latest = await bonReadReports();
  const latestKey = bonFindReportKey(latest, username) ?? key;
  const latestExisting = latest[latestKey] ?? bonNormalizeReport(undefined);

  if (latestExisting.contextItems.some((item) => item.permalink === path)) {
    return { ok: true, added: false, item };
  }

  latest[latestKey] = {
    ...latestExisting,
    contextItems: [...latestExisting.contextItems, item],
  };
  await bonWriteReports(latest);
  return { ok: true, added: true, item };
}

export async function bonDossierRemove(
  username: string,
  permalink: string
): Promise<{ ok: boolean; removed: boolean }> {
  if (!username || !permalink) {
    return { ok: false, removed: false };
  }

  const path = bonNormalizePermalink(permalink);
  const reports = await bonReadReports();
  const key = bonFindReportKey(reports, username);
  if (!key) {
    return { ok: true, removed: false };
  }

  const existing = reports[key];
  const next = existing.contextItems.filter((item) => item.permalink !== path);
  if (next.length === existing.contextItems.length) {
    return { ok: true, removed: false };
  }

  reports[key] = { ...existing, contextItems: next };
  await bonWriteReports(reports);
  return { ok: true, removed: true };
}

// Bulk presence map: { "<username>|<permalink>": true } for every entry the
// content-script asked about. Missing keys mean "not in dossier."
export async function bonDossierHasMap(
  queries: Array<{ username: string; permalink: string }>
): Promise<Record<string, true>> {
  if (!queries.length) {
    return {};
  }

  const reports = await bonReadReports();

  // Build a per-username Set of normalized permalinks once, then probe.
  const seenPerUser = new Map<string, Set<string>>();
  for (const query of queries) {
    const usernameLc = query.username.toLowerCase();
    if (seenPerUser.has(usernameLc)) {
      continue;
    }
    const key = bonFindReportKey(reports, query.username);
    if (!key) {
      seenPerUser.set(usernameLc, new Set());
      continue;
    }
    const items = reports[key].contextItems;
    seenPerUser.set(usernameLc, new Set(items.map((item) => item.permalink)));
  }

  const presenceMap: Record<string, true> = {};
  for (const query of queries) {
    const set = seenPerUser.get(query.username.toLowerCase());
    const path = bonNormalizePermalink(query.permalink);
    if (set && set.has(path)) {
      presenceMap[`${query.username.toLowerCase()}|${path}`] = true;
    }
  }
  return presenceMap;
}
