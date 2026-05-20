import type { Factor, Report } from "../../types.ts";

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

const BON_RECENT_REPORT_LIMIT = 5;

export function bonAiCommandBuildUserDetails(
  username: string,
  report: Report | undefined
): AiCommandUserDetails {
  if (!report) {
    return { username, found: false };
  }

  const investigation = report.investigation;

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
          verdict: investigation.verdict ?? null,
          botProbability: investigation.botProbability ?? null,
          confidence: investigation.confidence ?? null,
          summary: investigation.summary ?? "",
          persona: investigation.persona
            ? {
                label: investigation.persona.label,
                reasoning: investigation.persona.reasoning ?? "",
              }
            : null,
          region: investigation.region
            ? {
                code: investigation.region.code ?? null,
                reasoning: investigation.region.reasoning ?? "",
              }
            : null,
          factors: investigation.factors.map((factor) => ({
            key: factor.key,
            score: factor.score,
            confidence: factor.confidence,
            reasoning: factor.reasoning ?? "",
            evidence: bonNormalizeEvidence(factor),
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
      .slice(0, BON_RECENT_REPORT_LIMIT)
      .map((entry) => ({
        at: entry.at ? new Date(entry.at).toISOString() : "",
        subreddit: entry.subreddit ?? null,
        postTitle: entry.postTitle ?? null,
        permalink: entry.permalink ?? null,
      })),
  };
}

function bonNormalizeEvidence(factor: Factor): string[] {
  const value = factor.evidence;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof value === "string" && value) {
    return [value];
  }

  return [];
}
