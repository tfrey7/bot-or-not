// Background-context handler: rank ring candidates for one user across
// all stored reports and enrich each with the fields the dossier section
// renders (verdict, ring membership, account status).

import { readReports } from "../../storage";
import { findReportKey, investigationResults } from "../../utils/history.ts";
import { normalizeInvestigation } from "../../verdict.ts";
import { ringDetectionRankCandidates, type RingCandidate } from "./logic.ts";

export interface RingCandidateSummary extends RingCandidate {
  verdict: string | null;
  botProbability: number | null;
  ringId: string | null;
  userStatus: string | null;
}

export async function ringDetectionGetCandidates(
  username: string
): Promise<{ candidates: RingCandidateSummary[] }> {
  const reports = await readReports();

  const targetKey = findReportKey(reports, username);
  if (!targetKey) {
    return { candidates: [] };
  }

  const ranked = ringDetectionRankCandidates(targetKey, reports);

  const candidates = ranked.map((candidate): RingCandidateSummary => {
    const report = reports[candidate.username];
    const results = investigationResults(
      normalizeInvestigation(report.investigation, !!report.ringId)
    );

    return {
      ...candidate,
      verdict: results?.verdict ?? null,
      botProbability: results?.botProbability ?? null,
      ringId: report.ringId,
      userStatus: report.userStatus,
    };
  });

  return { candidates };
}
