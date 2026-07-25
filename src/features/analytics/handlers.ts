// Analytics — background message handler. Serves the metrics tab a
// projection of the report store that keeps runs[] history and verdict
// fields but drops the heavy dossier payloads (activity dumps, harvests,
// factor prose) — those are ~90% of the full records' bytes and the
// metrics tab never reads them.

import { readReports } from "../../storage";
import type { Investigation, Report } from "../../types.ts";

export async function analyticsGetReports(): Promise<{
  reports: Record<string, Report>;
}> {
  const reports = await readReports();
  const out: Record<string, Report> = {};

  for (const [username, report] of Object.entries(reports)) {
    out[username] = {
      ...report,
      history: [],
      activityData: null,
      googleHarvest: null,
      passiveHarvest: null,
      userNotes: null,
      investigation: slimInvestigation(report.investigation),
    };
  }

  return { reports: out };
}

function slimInvestigation(
  investigation: Investigation | null
): Investigation | null {
  if (!investigation || investigation.status !== "done") {
    return investigation;
  }

  return {
    ...investigation,
    results: {
      ...investigation.results,
      factors: [],
      persona: investigation.results.persona
        ? {
            label: investigation.results.persona.label,
            reasoning: "",
            archetypes: null,
          }
        : null,
      region: null,
      demographics: null,
    },
  };
}
