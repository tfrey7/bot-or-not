// Investigation pipeline orchestrator. Three public entry points:
//   bonInvestigateUser — full Reddit fetch → Claude → structured verdict
//   bonGatherProfile   — just the fetch + summarize step (shared by the
//                        background's two-step "set running, then call AI"
//                        flow that needs the inputs object to persist
//                        botBouncerStatus + activityData independently)
//   bonFetchUserActivity — lighter fetch for the reports page's "Load
//                          activity" button (no Claude call)
//
// `prompt.md` is the system prompt — Vite inlines it as a string at
// build time so there's no runtime fetch.

import BON_ANALYSIS_PROMPT from "./prompt.md?raw";
import type {
  ActivityData,
  BotBouncerStatus,
  ClaudeUsage,
  Factor,
  Persona,
  ProfileSummary,
  RedditFetchMetric,
  RedditMetrics,
  RedditProfile,
  RegionInferenceAi,
  Verdict,
  WebSearchResult,
} from "../../types.ts";
import { bonExtractJson } from "../../utils/json.ts";
import { bonNormalizePersona } from "../../utils/persona.ts";
import { bonExtractActivityData } from "../../utils/reddit_activity.ts";
import { bonNormalizeRegionInference } from "../../utils/region_inference.ts";
import { bonComputeVerdict } from "../../verdict.ts";
import { bonWebSearchRedditUser } from "../web-search/index.ts";
import { bonCallClaude } from "./api.ts";
import {
  bonFetchBotBouncerStatus,
  BON_REDDIT_DEEP_FETCH_LIMIT,
  bonFetchRedditActivity,
  bonFetchRedditProfile,
  RedditFetchError,
} from "./fetch.ts";
import { bonExtractSnoovatarUrl, bonSummarizeProfile } from "./summarize.ts";

// Caller-supplied context for an investigation. Both keys are independently
// optional — omit when no signal is on hand. The fields themselves never
// carry `null`; absence is expressed by omission.
export interface GatherProfileExtra {
  botBouncerStatus?: Exclude<BotBouncerStatus, null>;
  botBouncerCheckedAt?: number;
}

export interface GatheredProfile {
  summary: ProfileSummary;
  activityData: ActivityData;
  raw: RedditProfile;
  botBouncerStatus: BotBouncerStatus;
  botBouncerCheckedAt: number | null;
  redditMetrics: RedditMetrics;
  webSearchResults: WebSearchResult[];
  webSearchDurationMs: number;
  webSearchStatus: "ok" | "error";
  webSearchError: string | null;
}

export interface OneDAnalysisResult {
  verdict: Verdict;
  confidence: number;
  botProbability: number;
  summary: string;
  persona: Persona | null;
  region: RegionInferenceAi | null;
  factors: Factor[];
  runAt: number;
  model: string;
  usage: ClaudeUsage | null;
  webSearchCount: number;
  costUsd: number | null;
}

export async function bonFetchUserActivity(
  username: string
): Promise<ActivityData> {
  const { activity } = await bonFetchRedditActivity(username);
  return bonExtractActivityData(activity, BON_REDDIT_DEEP_FETCH_LIMIT);
}

// Fetch + summarize the account once so the analyzer works from a
// single Reddit fetch per investigation. Reddit profile, BotBouncer
// lookup, and DDG web search all run in parallel so the wall time is
// max() not sum() — the web search lands in time to be embedded in the
// summary that goes to Claude.
export async function bonGatherProfile(
  username: string,
  extra: GatherProfileExtra = {}
): Promise<GatheredProfile> {
  const wallStart = performance.now();

  const [profileSettled, botBouncerSettled, webSearchSettled] =
    await Promise.allSettled([
      bonFetchRedditProfile(username),
      bonFetchBotBouncerStatus(username),
      bonWebSearchRedditUser(username),
    ]);

  const botBouncerResult =
    botBouncerSettled.status === "fulfilled" ? botBouncerSettled.value : null;
  const webSearchResult =
    webSearchSettled.status === "fulfilled" ? webSearchSettled.value : null;

  const totalDurationMs = Math.round(performance.now() - wallStart);

  if (profileSettled.status === "rejected") {
    const reason = profileSettled.reason;
    const profileFetches: RedditFetchMetric[] =
      reason instanceof RedditFetchError ? reason.metrics.fetches : [];
    const combined: RedditMetrics = {
      fetches: [
        ...profileFetches,
        ...(botBouncerResult ? [botBouncerResult.metric] : []),
      ],
      totalDurationMs,
    };

    throw new RedditFetchError(
      reason instanceof Error ? reason.message : String(reason),
      combined
    );
  }

  const { profile, fetches: profileFetches } = profileSettled.value;
  const redditMetrics: RedditMetrics = {
    fetches: [
      ...profileFetches,
      ...(botBouncerResult ? [botBouncerResult.metric] : []),
    ],
    totalDurationMs,
  };

  const freshBotBouncerStatus = botBouncerResult?.status ?? null;
  const botBouncerStatus: BotBouncerStatus =
    freshBotBouncerStatus ?? extra.botBouncerStatus ?? null;
  const botBouncerCheckedAt: number | null = freshBotBouncerStatus
    ? Date.now()
    : (extra.botBouncerCheckedAt ?? null);

  const webSearchResults = webSearchResult?.results ?? [];
  const webSearchDurationMs = webSearchResult?.durationMs ?? 0;
  const webSearchStatus = webSearchResult?.status ?? "error";
  const webSearchError =
    webSearchResult?.error ??
    (webSearchSettled.status === "rejected"
      ? webSearchSettled.reason instanceof Error
        ? webSearchSettled.reason.message
        : String(webSearchSettled.reason)
      : null);

  const summary = bonSummarizeProfile(username, profile, {
    ...(botBouncerStatus ? { botBouncerStatus } : {}),
    ...(botBouncerCheckedAt != null ? { botBouncerCheckedAt } : {}),
    webSearchResults,
  });
  const activityData = bonExtractActivityData(profile);

  return {
    summary,
    activityData,
    raw: profile,
    botBouncerStatus,
    botBouncerCheckedAt,
    redditMetrics,
    webSearchResults,
    webSearchDurationMs,
    webSearchStatus,
    webSearchError,
  };
}

// Shape of the JSON object Claude returns. The prompt mandates every field;
// parseClaudeVerdict throws if anything is missing. Downstream code can trust
// the shape — no defensive `?? ""` / `Array.isArray()` checks anywhere else.
// `persona` stays `unknown` because bonNormalizePersona owns its validation.
interface ClaudeVerdictPayload {
  factors: Factor[];
  summary: string;
  persona: unknown;
  region: unknown;
}

function parseClaudeVerdict(rawText: string): ClaudeVerdictPayload {
  const extracted = bonExtractJson(rawText);
  if (!extracted || typeof extracted !== "object") {
    throw new Error("Could not parse verdict JSON from Claude response");
  }

  const payload = extracted as Record<string, unknown>;

  if (!Array.isArray(payload.factors)) {
    throw new Error("Claude response missing required `factors` array");
  }

  if (typeof payload.summary !== "string") {
    throw new Error("Claude response missing required `summary` string");
  }

  return {
    factors: payload.factors as Factor[],
    summary: payload.summary,
    persona: payload.persona,
    region: payload.region,
  };
}

// Runs the 1D bot↔human analysis against an already-built summary. The
// summary may already carry `web_search_results` from bonGatherProfile;
// the prompt reads them directly so the Claude call has no server-side
// search tool anymore.
export async function bonRunOneDAnalysis(
  apiKey: string,
  profileSummary: ProfileSummary,
  avatarUrl: string | null = null
): Promise<OneDAnalysisResult> {
  const { rawText, usage, model, costUsd } = await bonCallClaude(
    apiKey,
    BON_ANALYSIS_PROMPT,
    profileSummary,
    "claude 1D",
    { avatarUrl }
  );

  const parsed = parseClaudeVerdict(rawText);
  const derived = bonComputeVerdict(parsed.factors);

  return {
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
    summary: parsed.summary,
    persona: bonNormalizePersona(parsed.persona),
    region: bonNormalizeRegionInference(parsed.region),
    factors: parsed.factors,
    runAt: Date.now(),
    model,
    usage,
    webSearchCount:
      (profileSummary.web_search_results ?? []).length > 0 ? 1 : 0,
    costUsd,
  };
}

export interface InvestigateUserResult extends OneDAnalysisResult {
  postsFetched: number;
  commentsFetched: number;
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
  activityData: ActivityData;
  botBouncerStatus: BotBouncerStatus;
  botBouncerCheckedAt: number | null;
  redditMetrics: RedditMetrics;
}

// Single-call entry point: fetch the profile, run the 1D analyzer,
// return the combined investigation object.
export async function bonInvestigateUser(
  username: string,
  apiKey: string,
  extra: GatherProfileExtra = {}
): Promise<InvestigateUserResult> {
  const gathered = await bonGatherProfile(username, extra);
  const avatarUrl = bonExtractSnoovatarUrl(gathered.raw);
  const analysisResult = await bonRunOneDAnalysis(
    apiKey,
    gathered.summary,
    avatarUrl
  );

  return {
    ...analysisResult,
    postsFetched: gathered.raw.submitted.data?.children?.length ?? 0,
    commentsFetched: gathered.raw.comments.data?.children?.length ?? 0,
    accountCreatedAt: gathered.summary.account.created_at,
    accountAgeDays: gathered.summary.account.age_days,
    activityData: gathered.activityData,
    botBouncerStatus: gathered.botBouncerStatus,
    botBouncerCheckedAt: gathered.botBouncerCheckedAt,
    redditMetrics: gathered.redditMetrics,
  };
}

export { RedditFetchError };
export { bonExtractSnoovatarUrl };
