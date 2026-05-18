// Analytics — business logic. Pure transforms over the reports object:
// walks each user's investigation/runs[] history to build the flat list of
// analytics entries, and reduces that list into the summary stats object
// the renderer consumes. No DOM, no I/O.

import {
  bonEstimateCostUsd,
  bonLookupPricing,
  bonRecentCost,
} from "../../utils/cost.js";
import { bonPercentile } from "../../utils/stats.js";

export function bonAnalyticsCollect(reports) {
  const out = [];
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

function buildAnalyticsEntry(username, run) {
  const calls = [];
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
  return {
    username,
    status: run.status,
    runAt: run.runAt || null,
    durationMs: typeof run.durationMs === "number" ? run.durationMs : null,
    verdict: run.verdict || null,
    confidence: typeof run.confidence === "number" ? run.confidence : null,
    botProbability:
      typeof run.botProbability === "number" ? run.botProbability : null,
    persona: run.persona?.label || null,
    summary: typeof run.summary === "string" ? run.summary : "",
    postsFetched: run.postsFetched || 0,
    commentsFetched: run.commentsFetched || 0,
    calls,
    totalCost,
  };
}

export function bonAnalyticsSummarize(runs) {
  const s = {
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
  };
  const durations = [];
  const days = new Set();
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
