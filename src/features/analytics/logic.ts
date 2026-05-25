// Analytics — business logic. Pure transforms over the reports object:
// walks each user's investigation/runs[] history to build the flat list of
// analytics entries the chart/table widgets consume. No DOM, no I/O.

import type {
  ClaudeUsage,
  RedditMetrics,
  Report,
  RunSnapshot,
  Verdict,
} from "../../types.ts";
import { snapshotRun } from "../../utils/history.ts";
import { estimateCostUsd } from "../../llm/cost.ts";

export interface AnalyticsCall {
  kind: string;
  model: string | null;
  usage: ClaudeUsage | null;
  costUsd: number | null;
}

export interface AnalyticsEntry {
  username: string;
  status: "running" | "done" | "error";
  runAt: number | null;
  durationMs: number | null;
  verdict: Verdict | null;
  confidence: number | null;
  botProbability: number | null;
  persona: string | null;
  summary: string;
  postsFetched: number;
  commentsFetched: number;
  calls: AnalyticsCall[];
  totalCost: number;
  redditMetrics: RedditMetrics | null;
}

export function analyticsCollect(
  reports: Array<Report & { username: string }> | null | undefined
): AnalyticsEntry[] {
  const entries: AnalyticsEntry[] = [];

  for (const report of reports || []) {
    const investigation = report?.investigation;

    if (!investigation) {
      continue;
    }

    // Newer records keep a runs[] history; emit one analytics entry per
    // historical run so re-investigations don't collapse into a single row.
    if (investigation.runs.length > 0) {
      for (const run of investigation.runs) {
        entries.push(buildAnalyticsEntry(report.username, run, null, null));
      }

      // If a run is currently in flight, runs[] doesn't include it yet —
      // skip it (analytics only cares about completed runs).
      continue;
    }

    // Legacy record (no runs[] history yet). If the current investigation
    // has produced a result, materialize it as a one-off snapshot so it
    // still shows up in analytics. RunSnapshot doesn't carry persona/summary,
    // so pass them alongside.
    if (investigation.status === "done") {
      entries.push(
        buildAnalyticsEntry(
          report.username,
          snapshotRun(investigation, "done"),
          investigation.results.summary,
          investigation.results.persona?.label ?? null
        )
      );
    }
  }

  return entries;
}

function buildAnalyticsEntry(
  username: string,
  run: RunSnapshot,
  summary: string | null,
  persona: string | null
): AnalyticsEntry {
  const calls: AnalyticsCall[] = [];

  if (run.usage) {
    calls.push({
      kind: "1d",
      model: run.model || null,
      usage: run.usage,
      costUsd:
        typeof run.costUsd === "number"
          ? run.costUsd
          : estimateCostUsd(run.usage, run.model),
    });
  }

  const totalCost = calls.reduce((sum, call) => sum + (call.costUsd || 0), 0);

  return {
    username,
    status: run.status as AnalyticsEntry["status"],
    runAt: run.runAt || null,
    durationMs: run.durationMs,
    verdict: run.verdict,
    confidence: run.confidence,
    botProbability: run.botProbability,
    persona,
    summary: summary ?? "",
    postsFetched: run.postsFetched,
    commentsFetched: run.commentsFetched,
    calls,
    totalCost,
    redditMetrics: run.redditMetrics,
  };
}
