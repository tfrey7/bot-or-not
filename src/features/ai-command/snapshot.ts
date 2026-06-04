import type { Factor, Report } from "../../types.ts";
import { investigationResults } from "../../utils/history.ts";

export interface AiCommandSnapshotEntry {
  username: string;
  ringId: string | null;
  reportCount: number;
  userStatus: string | null;

  // Investigation lifecycle. `null` = no investigation has ever been started.
  // Result fields below (verdict, persona, scores, …) are only populated when
  // status === "done".
  investigationStatus: string | null;
  verdict: string | null;
  botProbability: number | null;
  confidence: number | null;

  // AI's persona label — one of the archetype keys ("doomer", "superfan", …) or
  // "bot" / "normal". For "show users with the Doomer tag" check this field.
  persona: string | null;

  // Per-archetype strength (0..1) from the persona radar. Use when the
  // operator wants to filter on a flavor that didn't necessarily land as the
  // top label — e.g. "everyone with high doomer score".
  archetypes: Record<string, number> | null;

  // Per-factor bot↔human score (-1 = strong human, +1 = strong bot) keyed
  // by factor key from src/factors.ts. Use to answer "show accounts with
  // high LLM content style" or "everyone with a positive karma_farming_subs".
  factorScores: Record<string, number> | null;

  // Deterministic country code ("US", "GB", "IN" …) when region inference was
  // confident enough to nominate one; null when ambiguous or insufficient
  // signal. Computed by the caller (background.ts) because the inference
  // helpers live alongside the reports feature — we keep this module
  // feature-isolated by accepting the precomputed map.
  region: string | null;

  // Operator's own persona ratings from the notes pane — independent of the
  // AI's persona call. Empty array if the operator hasn't rated this user.
  ratings: string[];

  // Account-shape signals available pre-investigation. Useful for
  // "show accounts younger than 30 days" or "everyone Bot Bouncer flagged".
  totalKarma: number | null;
  accountAgeDays: number | null;
  botBouncerStatus: string | null;
  profileHidden: boolean;
}

// Slim view of the reports store handed to the agent as context. Strips
// investigation details, history, and activity — Claude only needs the
// identifier columns to resolve "alice and bob" or "everyone in ring abc-123"
// into concrete usernames, plus the filterable attributes.
export function aiCommandBuildSnapshot(
  reports: Record<string, Report>,
  regions: Record<string, string | null> = {}
): AiCommandSnapshotEntry[] {
  return Object.entries(reports).map(([username, report]) => {
    const investigation = report.investigation;
    const results = investigationResults(investigation);
    const factorScores = results ? snapshotFactorScores(results.factors) : null;

    const archetypes = results?.persona?.archetypes
      ? snapshotArchetypeScores(results.persona.archetypes)
      : null;

    return {
      username,
      ringId: report.ringId ?? null,
      reportCount: report.count,
      userStatus: report.userStatus ?? null,

      investigationStatus: investigation?.status ?? null,
      verdict: results?.verdict ?? null,
      botProbability: round2(results?.botProbability ?? null),
      confidence: round2(results?.confidence ?? null),
      persona: results?.persona?.label ?? null,
      archetypes,
      factorScores,

      region: regions[username] ?? null,

      ratings: report.userNotes?.ratings ? [...report.userNotes.ratings] : [],

      totalKarma: report.totalKarma,
      accountAgeDays: results?.accountAgeDays ?? null,
      botBouncerStatus: report.botBouncerStatus,
      profileHidden: report.profileHidden,
    };
  });
}

function snapshotFactorScores(
  factors: readonly Factor[]
): Record<string, number> | null {
  if (factors.length === 0) {
    return null;
  }

  const out: Record<string, number> = {};

  for (const factor of factors) {
    const rounded = round2(factor.score);
    if (rounded !== null) {
      out[factor.key] = rounded;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function snapshotArchetypeScores(
  archetypes: Record<string, number>
): Record<string, number> | null {
  const out: Record<string, number> = {};

  for (const [key, value] of Object.entries(archetypes)) {
    const rounded = round2(value);
    if (rounded !== null) {
      out[key] = rounded;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function round2(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

// Full dossier shape returned by the `read_user_details` tool. The slim
// snapshot exists for cheap resolution; this is the deep read the agent
// reaches for when the operator's question requires prose ("what did the
// summary mean by X?", "compare these two", "recap alice's case").
export interface AiCommandUserDetails {
  username: string;
  found: boolean;
  ringId?: string | null;
  userStatus?: string | null;
  reportCount?: number;
  lastReportedAt?: string | null;
  investigation?: {
    status: string;
    verdict: string | null;
    botProbability: number | null;
    confidence: number | null;
    summary: string;
    persona: {
      label: string;
      reasoning: string;
    } | null;
    region: {
      code: string | null;
      reasoning: string;
    } | null;
    factors: Array<{
      key: string;
      score: number;
      confidence: number;
      reasoning: string;
      evidence: string[];
    }>;
  } | null;
  notes?: {
    ratings: string[];
    note: string;
  } | null;
  recentReports?: Array<{
    at: string;
    subreddit: string | null;
    postTitle: string | null;
    permalink: string | null;
  }>;
}

const RECENT_REPORT_LIMIT = 5;

export function aiCommandBuildUserDetails(
  username: string,
  report: Report | undefined
): AiCommandUserDetails {
  if (!report) {
    return { username, found: false };
  }

  const investigation = report.investigation;
  const results = investigationResults(investigation);

  return {
    username,
    found: true,
    ringId: report.ringId ?? null,
    userStatus: report.userStatus ?? null,
    reportCount: report.count,
    lastReportedAt: report.lastReportedAt
      ? new Date(report.lastReportedAt).toISOString()
      : null,
    investigation: investigation
      ? {
          status: investigation.status,
          verdict: results?.verdict ?? null,
          botProbability: results?.botProbability ?? null,
          confidence: results?.confidence ?? null,
          summary: results?.summary ?? "",
          persona: results?.persona
            ? {
                label: results.persona.label,
                reasoning: results.persona.reasoning ?? "",
              }
            : null,
          region: results?.region
            ? {
                code: results.region.code ?? null,
                reasoning: results.region.reasoning ?? "",
              }
            : null,
          factors: (results?.factors ?? []).map((factor) => ({
            key: factor.key,
            score: factor.score,
            confidence: factor.confidence,
            reasoning: factor.reasoning,
            evidence: normalizeEvidence(factor),
          })),
        }
      : null,
    notes: report.userNotes
      ? {
          ratings: [...report.userNotes.ratings],
          note: report.userNotes.note,
        }
      : null,
    recentReports: report.history
      .slice()
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, RECENT_REPORT_LIMIT)
      .map((entry) => ({
        at: entry.at ? new Date(entry.at).toISOString() : "",
        subreddit: entry.subreddit ?? null,
        postTitle: entry.postTitle ?? null,
        permalink: entry.permalink ?? null,
      })),
  };
}

function normalizeEvidence(factor: Factor): string[] {
  const value = factor.evidence;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof value === "string" && value) {
    return [value];
  }

  return [];
}
