// Verdict-outcome calibration over the live report store: what Reddit has
// since done (suspended / deleted) to the accounts each verdict was issued
// on. Extension-side twin of scripts/outcomes.ts — statuses here are as
// fresh as the status re-check sweep instead of a stale backup export.

import type { Report, Verdict } from "../../types.ts";
import { isControlCohortMember } from "../../utils/control_cohort.ts";
import { investigationResults } from "../../utils/history.ts";
import { isSuspectedBot, normalizeInvestigation } from "../../verdict.ts";

const VERDICT_OUTCOME_ORDER: Verdict[] = [
  "bot",
  "likely-bot",
  "uncertain",
  "likely-human",
  "human",
];

export interface VerdictOutcomeRow {
  verdict: Verdict;
  total: number;
  suspended: number;
  deleted: number;
  active: number;
  unknown: number;
  goneRate: number | null;
}

interface LongestSurvivingBotVerdict {
  username: string;
  runAt: number;
}

interface ControlCohortOutcomes {
  total: number;
  known: number;
  gone: number;
  goneRate: number | null;
}

export interface VerdictOutcomes {
  investigated: number;
  rows: VerdictOutcomeRow[];
  botSideGoneRate: number | null;
  controlCohort: ControlCohortOutcomes;
  longestSurviving: LongestSurvivingBotVerdict | null;
}

export function analyticsVerdictOutcomes(
  reports: Array<Report & { username: string }>
): VerdictOutcomes {
  const analyzed: Array<{
    username: string;
    verdict: Verdict;
    runAt: number;
    status: Report["userStatus"];
  }> = [];

  for (const report of reports) {
    const results = investigationResults(
      normalizeInvestigation(report.investigation, report.ringId !== null)
    );

    if (results) {
      analyzed.push({
        username: report.username,
        verdict: results.verdict,
        runAt: results.runAt,
        status: report.userStatus,
      });
    }
  }

  const rows = VERDICT_OUTCOME_ORDER.map((verdict): VerdictOutcomeRow => {
    const group = analyzed.filter((entry) => entry.verdict === verdict);
    const suspended = group.filter((e) => e.status === "suspended").length;
    const deleted = group.filter((e) => e.status === "deleted").length;
    const active = group.filter((e) => e.status === "active").length;
    const known = suspended + deleted + active;

    return {
      verdict,
      total: group.length,
      suspended,
      deleted,
      active,
      unknown: group.length - known,
      goneRate: known === 0 ? null : (suspended + deleted) / known,
    };
  });

  const botSide = rows.filter(
    (row) => row.verdict === "bot" || row.verdict === "likely-bot"
  );
  const botKnown = botSide.reduce(
    (sum, row) => sum + row.suspended + row.deleted + row.active,
    0
  );
  const botGone = botSide.reduce(
    (sum, row) => sum + row.suspended + row.deleted,
    0
  );

  // The control cohort is the human-side accounts the re-check sweep actually
  // tracks — its gone rate is the baseline the bot-side rate is measured
  // against, since untracked human rows only update on incidental browsing.
  const controlEntries = analyzed.filter(
    (entry) =>
      !isSuspectedBot(entry.verdict) && isControlCohortMember(entry.username)
  );
  const controlKnown = controlEntries.filter(
    (entry) =>
      entry.status === "suspended" ||
      entry.status === "deleted" ||
      entry.status === "active"
  );
  const controlGone = controlKnown.filter(
    (entry) => entry.status === "suspended" || entry.status === "deleted"
  ).length;

  const controlCohort: ControlCohortOutcomes = {
    total: controlEntries.length,
    known: controlKnown.length,
    gone: controlGone,
    goneRate:
      controlKnown.length === 0 ? null : controlGone / controlKnown.length,
  };

  // The oldest bot-side verdict Reddit hasn't acted on — either our most
  // durable false positive or Reddit's most durable miss; worth a look
  // periodically either way.
  let longestSurviving: LongestSurvivingBotVerdict | null = null;

  for (const entry of analyzed) {
    if (entry.verdict !== "bot" && entry.verdict !== "likely-bot") {
      continue;
    }

    if (entry.status === "suspended" || entry.status === "deleted") {
      continue;
    }

    if (longestSurviving === null || entry.runAt < longestSurviving.runAt) {
      longestSurviving = { username: entry.username, runAt: entry.runAt };
    }
  }

  return {
    investigated: analyzed.length,
    rows,
    botSideGoneRate: botKnown === 0 ? null : botGone / botKnown,
    controlCohort,
    longestSurviving,
  };
}
