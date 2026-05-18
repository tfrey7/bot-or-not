// Analytics — business logic. Pure transforms over the reports object:
// walks each user's investigation/runs[] history to build the flat list of
// analytics entries, and reduces that list into the summary stats object
// the renderer consumes. No DOM, no I/O.

import type {
  ClaudeUsage,
  Investigation,
  Report,
  RunSnapshot,
  Verdict,
} from "../../types.ts";
import {
  bonEstimateCostUsd,
  bonLookupPricing,
  bonRecentCost,
} from "../../utils/cost.ts";
import { bonPercentile } from "../../utils/stats.ts";

export interface AnalyticsCall {
  kind: string;
  model: string | null;
  usage: ClaudeUsage | null;
  costUsd: number | null;
  webSearchCount: number;
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
}

export interface AnalyticsModelTotals {
  model: string;
  calls: number;
  cost: number;
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  duration: number;
}

export interface AnalyticsSummary {
  count: number;
  totalCost: number;
  totalDuration: number;
  totalApiCalls: number;
  totalWebSearches: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalPosts: number;
  totalComments: number;
  cacheSavingsUsd: number;
  models: Record<string, AnalyticsModelTotals>;
  daysActive: number;
  firstRunAt: number | null;
  lastRunAt: number | null;
  avgCost: number;
  medianCost: number;
  maxCost: number;
  avgDuration: number;
  medianDuration: number;
  p95Duration: number;
  totalTokens: number;
  cacheHitRate: number;
  runsPerActiveDay: number;
  recentCost: number;
  recentDays: number;
}

// Anything with the per-run fields buildAnalyticsEntry looks at.
type RunLike = RunSnapshot | Investigation;

export function bonAnalyticsCollect(
  reports: Array<Report & { username: string }> | null | undefined
): AnalyticsEntry[] {
  const out: AnalyticsEntry[] = [];

  for (const r of reports || []) {
    const inv = r?.investigation;

    if (!inv) {
      continue;
    }

    // Newer records keep a runs[] history; emit one analytics entry per
    // historical run so re-investigations don't collapse into a single row.
    if (Array.isArray(inv.runs) && inv.runs.length > 0) {
      for (const run of inv.runs) {
        out.push(buildAnalyticsEntry(r.username, run));
      }
      // If a run is currently in flight, runs[] doesn't include it yet —
      // skip it (analytics only cares about completed runs).
      continue;
    }

    // Legacy record (single most-recent run only). Treat the root fields as
    // one run.
    out.push(buildAnalyticsEntry(r.username, inv));
  }
  return out;
}

function buildAnalyticsEntry(username: string, run: RunLike): AnalyticsEntry {
  const calls: AnalyticsCall[] = [];

  if (run.usage) {
    calls.push({
      kind: "1d",
      model: run.model || null,
      usage: run.usage,
      costUsd:
        typeof run.costUsd === "number"
          ? run.costUsd
          : bonEstimateCostUsd(run.usage, run.model, run.webSearchCount),
      webSearchCount: run.webSearchCount || 0,
    });
  }

  const totalCost = calls.reduce((s, c) => s + (c.costUsd || 0), 0);
  const personaLabel =
    "persona" in run && run.persona && typeof run.persona === "object"
      ? (run.persona as { label?: string }).label || null
      : null;

  return {
    username,
    status: (run.status || "done") as AnalyticsEntry["status"],
    runAt: run.runAt || null,
    durationMs: typeof run.durationMs === "number" ? run.durationMs : null,
    verdict: (run.verdict as Verdict | undefined) || null,
    confidence: typeof run.confidence === "number" ? run.confidence : null,
    botProbability:
      typeof run.botProbability === "number" ? run.botProbability : null,
    persona: personaLabel,
    summary:
      "summary" in run && typeof run.summary === "string" ? run.summary : "",
    postsFetched: run.postsFetched || 0,
    commentsFetched: run.commentsFetched || 0,
    calls,
    totalCost,
  };
}

export function bonAnalyticsSummarize(
  runs: AnalyticsEntry[]
): AnalyticsSummary {
  const s: AnalyticsSummary = {
    count: runs.length,
    totalCost: 0,
    totalDuration: 0,
    totalApiCalls: 0,
    totalWebSearches: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalPosts: 0,
    totalComments: 0,
    cacheSavingsUsd: 0,
    models: {},
    daysActive: 0,
    firstRunAt: null,
    lastRunAt: null,
    avgCost: 0,
    medianCost: 0,
    maxCost: 0,
    avgDuration: 0,
    medianDuration: 0,
    p95Duration: 0,
    totalTokens: 0,
    cacheHitRate: 0,
    runsPerActiveDay: 0,
    recentCost: 0,
    recentDays: 7,
  };
  const durations: number[] = [];
  const days = new Set<string>();
  let firstRun = Infinity;
  let lastRun = -Infinity;

  for (const r of runs) {
    s.totalCost += r.totalCost;

    if (typeof r.durationMs === "number") {
      s.totalDuration += r.durationMs;
      durations.push(r.durationMs);
    }

    s.totalPosts += r.postsFetched;
    s.totalComments += r.commentsFetched;

    if (r.runAt) {
      firstRun = Math.min(firstRun, r.runAt);
      lastRun = Math.max(lastRun, r.runAt);
      const d = new Date(r.runAt);
      days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }

    for (const c of r.calls) {
      s.totalApiCalls++;
      s.totalWebSearches += c.webSearchCount || 0;
      const u = c.usage || {};
      s.totalInput += u.input_tokens || 0;
      s.totalOutput += u.output_tokens || 0;
      s.totalCacheRead += u.cache_read_input_tokens || 0;
      s.totalCacheWrite += u.cache_creation_input_tokens || 0;

      if (c.model) {
        const m = s.models[c.model] || {
          model: c.model,
          calls: 0,
          cost: 0,
          in: 0,
          out: 0,
          cacheRead: 0,
          cacheWrite: 0,
          duration: 0,
        };
        m.calls++;
        m.cost += c.costUsd || 0;
        m.in += u.input_tokens || 0;
        m.out += u.output_tokens || 0;
        m.cacheRead += u.cache_read_input_tokens || 0;
        m.cacheWrite += u.cache_creation_input_tokens || 0;
        s.models[c.model] = m;
      }
    }
  }

  durations.sort((a, b) => a - b);
  s.daysActive = days.size;
  s.firstRunAt = isFinite(firstRun) ? firstRun : null;
  s.lastRunAt = isFinite(lastRun) ? lastRun : null;
  s.avgCost = s.count ? s.totalCost / s.count : 0;
  s.medianCost = s.count
    ? bonPercentile(
        runs.map((r) => r.totalCost).sort((a, b) => a - b),
        0.5
      )
    : 0;
  s.maxCost = s.count ? Math.max(...runs.map((r) => r.totalCost)) : 0;
  s.avgDuration = durations.length ? s.totalDuration / durations.length : 0;
  s.medianDuration = bonPercentile(durations, 0.5);
  s.p95Duration = bonPercentile(durations, 0.95);
  s.totalTokens =
    s.totalInput + s.totalOutput + s.totalCacheRead + s.totalCacheWrite;
  s.cacheHitRate =
    s.totalInput + s.totalCacheRead > 0
      ? s.totalCacheRead / (s.totalInput + s.totalCacheRead)
      : 0;
  s.runsPerActiveDay = s.daysActive ? s.count / s.daysActive : 0;

  // Estimate dollars saved by cache reads vs. paying full input price.
  let savings = 0;

  for (const m of Object.values(s.models)) {
    const p = bonLookupPricing(m.model);

    if (!p) {
      continue;
    }

    savings += (m.cacheRead * (p.input - p.cacheRead)) / 1_000_000;
  }

  s.cacheSavingsUsd = savings;

  // Burn rate over last 7 days of activity (only counting days with runs
  // to avoid a misleadingly low rate for sporadic use).
  s.recentCost = bonRecentCost(runs, 7);
  s.recentDays = 7;
  return s;
}
