import type { Report } from "../../types.ts";

export interface AiCommandSnapshotEntry {
  username: string;
  ringId: string | null;
  verdict: string | null;
  userStatus: string | null;
  reportCount: number;

  // Deterministic country code ("US", "GB", "IN" …) when region inference was
  // confident enough to nominate one; null when ambiguous or insufficient
  // signal. Computed by the caller (background.ts) because the inference
  // helpers live alongside the reports feature — we keep this module
  // feature-isolated by accepting the precomputed map.
  region: string | null;
}

// Slim view of the reports store handed to the agent as context. Strips
// investigation details, history, and activity — Claude only needs the
// identifier columns to resolve "alice and bob" or "everyone in ring abc-123"
// into concrete usernames, plus a few filterable attributes.
export function bonAiCommandBuildSnapshot(
  reports: Record<string, Report>,
  regions: Record<string, string | null> = {}
): AiCommandSnapshotEntry[] {
  return Object.entries(reports).map(([username, report]) => ({
    username,
    ringId: report.ringId ?? null,
    verdict: report.investigation?.verdict ?? null,
    userStatus: report.userStatus ?? null,
    reportCount: report.count,
    region: regions[username] ?? null,
  }));
}
