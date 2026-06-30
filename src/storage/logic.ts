// Pure projections shared by every StorageAdapter implementation.

import type { Investigation, Report } from "../types.ts";

// Strip a canonical Report down to the fields the reports-page list, its
// active/queue table, and the structural-change diff actually read. The
// dropped fields (activity timestamps, history, harvest blobs, factor prose,
// run snapshots, persona/region) are only consumed by the detail pane and the
// heavy tabs, which fetch the full record on demand.
export function slimReport(report: Report): Report {
  return {
    ...report,
    history: [],
    activityData: null,
    googleHarvest: null,
    passiveHarvest: null,
    userNotes: null,
    investigation: slimInvestigation(report.investigation),
  };
}

function slimInvestigation(
  investigation: Investigation | null
): Investigation | null {
  if (!investigation) {
    return null;
  }

  if (investigation.status === "done") {
    return {
      ...investigation,
      runs: [],
      redditMetrics: null,
      results: {
        ...investigation.results,
        factors: [],
        persona: null,
        region: null,
        demographics: null,
        usage: null,
      },
    };
  }

  return {
    ...investigation,
    runs: [],
    redditMetrics: null,
  };
}
