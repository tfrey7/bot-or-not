// Investigation pipeline orchestrator. Two public entry points:
//   bonInvestigateUser — full Reddit fetch → Claude → structured verdict
//   bonGatherProfile   — just the fetch + summarize step (shared by the
//                        background's two-step "set running, then call AI"
//                        flow that needs the inputs object to persist
//                        botBouncerStatus + activityData independently)
//
// `prompt.md` is the system prompt — Vite inlines it as a string at
// build time so there's no runtime fetch.

import BON_ANALYSIS_PROMPT from "./prompt.md?raw";
import type { LlmVendor } from "../../llm/index.ts";
import type {
  ActivityData,
  BotBouncerStatus,
  ClaudeUsage,
  Demographics,
  Factor,
  GoogleHarvest,
  PassiveHarvest,
  Persona,
  ProfileSummary,
  RedditFetchMetric,
  RedditMetrics,
  RedditProfile,
  RegionInferenceAi,
  Verdict,
} from "../../types.ts";
import { BON_FACTORS } from "../../factors.ts";
import { bonNormalizeDemographics } from "../../utils/demographics.ts";
import { bonExtractJson } from "../../utils/json.ts";
import { bonNormalizePersona } from "../../utils/persona.ts";
import { bonExtractActivityData } from "../../utils/reddit_activity.ts";
import { bonNormalizeRegionInference } from "../../utils/region_inference.ts";
import { bonComputeVerdict } from "../../verdict.ts";
import { bonInvestigationCallLlm } from "./api.ts";
import { bonAssemblePrompt } from "./assemble_prompt.ts";
import {
  BON_DETERMINISTIC_FACTOR_KEYS,
  bonScoreDeterministicFactors,
} from "./deterministic_factors.ts";
import {
  bonFetchBotBouncerStatus,
  BON_REDDIT_FETCH_LIMIT,
  bonFetchRedditProfile,
  RedditFetchError,
} from "./fetch.ts";
import { bonMergeFactors } from "./merge_factors.ts";
import { bonExtractSnoovatarUrl, bonSummarizeProfile } from "./summarize.ts";

// Factor keys the LLM is asked to score. The six factors in
// BON_DETERMINISTIC_FACTOR_KEYS are scored in TS instead — see
// `deterministic_factors.ts`. Keeping these out of the LLM's prompt
// trims ~16% of input tokens AND ~27% of output tokens per call.
const BON_LLM_FACTOR_KEYS: readonly string[] = BON_FACTORS.map(
  (f) => f.key
).filter(
  (k) => !(BON_DETERMINISTIC_FACTOR_KEYS as readonly string[]).includes(k)
);

// Caller-supplied context for an investigation. Both keys are independently
// optional — omit when no signal is on hand. The fields themselves never
// carry `null`; absence is expressed by omission.
export interface GatherProfileExtra {
  botBouncerStatus?: Exclude<BotBouncerStatus, null>;
  botBouncerCheckedAt?: number;
  googleHarvest?: GoogleHarvest;
  passiveHarvest?: PassiveHarvest;
}

export interface GatheredProfile {
  summary: ProfileSummary;
  activityData: ActivityData;
  raw: RedditProfile;
  botBouncerStatus: BotBouncerStatus;
  botBouncerCheckedAt: number | null;
  redditMetrics: RedditMetrics;
}

export interface OneDAnalysisResult {
  verdict: Verdict;
  confidence: number;
  botProbability: number;
  summary: string;
  persona: Persona | null;
  region: RegionInferenceAi | null;
  demographics: Demographics | null;
  factors: Factor[];
  runAt: number;
  model: string;
  usage: ClaudeUsage | null;
  costUsd: number | null;
}

// Fetch + summarize the account once so the analyzer works from a
// single Reddit fetch per investigation. Reddit profile and BotBouncer
// lookup run in parallel so the wall time is max() not sum().
export async function bonGatherProfile(
  username: string,
  extra: GatherProfileExtra = {}
): Promise<GatheredProfile> {
  const wallStart = performance.now();

  const [profileSettled, botBouncerSettled] = await Promise.allSettled([
    bonFetchRedditProfile(username),
    bonFetchBotBouncerStatus(username),
  ]);

  const botBouncerResult =
    botBouncerSettled.status === "fulfilled" ? botBouncerSettled.value : null;

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
      combined,
      reason instanceof RedditFetchError ? reason.httpStatus : null
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

  const summary = bonSummarizeProfile(username, profile, {
    ...(botBouncerStatus ? { botBouncerStatus } : {}),
    ...(botBouncerCheckedAt != null ? { botBouncerCheckedAt } : {}),
    ...(extra.googleHarvest ? { googleHarvest: extra.googleHarvest } : {}),
    ...(extra.passiveHarvest ? { passiveHarvest: extra.passiveHarvest } : {}),
  });
  const activityData = bonExtractActivityData(profile, BON_REDDIT_FETCH_LIMIT);

  return {
    summary,
    activityData,
    raw: profile,
    botBouncerStatus,
    botBouncerCheckedAt,
    redditMetrics,
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
  demographics: unknown;
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
    demographics: payload.demographics,
  };
}

// Caller-supplied LLM selection. Both fields nullable — null on either
// means "let the provider/factory decide" (default backend, default model).
export interface BonInvestigationLlmSelection {
  vendor?: LlmVendor | null;
  model?: string | null;
}

// Runs the 1D bot↔human analysis against an already-built summary. The
// system prompt is assembled per call: the six deterministic factor
// rubrics are stripped out (we score those in TS), but the input-shape
// conditionals (google_harvest, passive_harvest, hidden_profile, avatar)
// are kept always-included so the assembled prompt is byte-identical
// across users — that keeps the Anthropic prompt cache hit rate at
// baseline levels instead of fragmenting per user.
export async function bonRunOneDAnalysis(
  apiKey: string,
  profileSummary: ProfileSummary,
  avatarUrl: string | null = null,
  selection: BonInvestigationLlmSelection = {}
): Promise<OneDAnalysisResult> {
  const systemPrompt = bonAssemblePrompt(BON_ANALYSIS_PROMPT, profileSummary, {
    llmFactorKeys: BON_LLM_FACTOR_KEYS,
    stripInputConditional: false,
  });
  const deterministicFactors = bonScoreDeterministicFactors(profileSummary);

  const { rawText, usage, model, costUsd } = await bonInvestigationCallLlm(
    apiKey,
    systemPrompt,
    profileSummary,
    "investigation 1D",
    {
      avatarUrl,
      vendor: selection.vendor ?? null,
      model: selection.model ?? null,
    }
  );

  const parsed = parseClaudeVerdict(rawText);
  const factors = bonMergeFactors(parsed.factors, deterministicFactors);
  const derived = bonComputeVerdict(factors);

  return {
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
    summary: parsed.summary,
    persona: bonNormalizePersona(parsed.persona),
    region: bonNormalizeRegionInference(parsed.region),
    demographics: bonNormalizeDemographics(parsed.demographics),
    factors,
    runAt: Date.now(),
    model,
    usage,
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
  extra: GatherProfileExtra = {},
  selection: BonInvestigationLlmSelection = {}
): Promise<InvestigateUserResult> {
  const gathered = await bonGatherProfile(username, extra);
  const avatarUrl = bonExtractSnoovatarUrl(gathered.raw);
  const analysisResult = await bonRunOneDAnalysis(
    apiKey,
    gathered.summary,
    avatarUrl,
    selection
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
