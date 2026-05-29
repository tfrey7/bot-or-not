// Investigation pipeline orchestrator. Two public entry points:
//   investigateUser — full Reddit fetch → Claude → structured verdict
//   gatherProfile   — just the fetch + summarize step (shared by the
//                        background's two-step "set running, then call AI"
//                        flow that needs the inputs object to persist
//                        botBouncerStatus + activityData independently)
//
// `prompt.md` is the system prompt — Vite inlines it as a string at
// build time so there's no runtime fetch.

import ANALYSIS_PROMPT from "./prompt.md?raw";
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
import { FACTORS } from "../../factors.ts";
import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import { normalizeDemographics } from "../../utils/demographics.ts";
import { extractJson } from "../../utils/json.ts";
import { normalizePersona } from "../../utils/persona.ts";
import { extractActivityData } from "../../utils/reddit_activity.ts";
import { normalizeRegionInference } from "../../utils/region_inference.ts";
import { computeVerdict } from "../../verdict.ts";
import { investigationCallLlm } from "./api.ts";
import { assemblePrompt } from "./assemble_prompt.ts";
import {
  DETERMINISTIC_FACTOR_KEYS,
  scoreDeterministicFactors,
} from "./deterministic_factors.ts";
import {
  fetchBotBouncerStatus,
  REDDIT_FETCH_LIMIT,
  fetchRedditProfile,
  RedditFetchError,
} from "./fetch.ts";
import { mergeFactors } from "./merge_factors.ts";
import { extractSnoovatarUrl, summarizeProfile } from "./summarize.ts";

// Factor keys the LLM is asked to score. The six factors in
// DETERMINISTIC_FACTOR_KEYS are scored in TS instead — see
// `deterministic_factors.ts`. Keeping these out of the LLM's prompt
// trims ~16% of input tokens AND ~27% of output tokens per call.
const LLM_FACTOR_KEYS: readonly string[] = FACTORS.map((f) => f.key).filter(
  (k) => !(DETERMINISTIC_FACTOR_KEYS as readonly string[]).includes(k)
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
export async function gatherProfile(
  username: string,
  extra: GatherProfileExtra = {},
  priority: number = QUEUE_PRIORITY.bulk
): Promise<GatheredProfile> {
  const wallStart = performance.now();

  const [profileSettled, botBouncerSettled] = await Promise.allSettled([
    fetchRedditProfile(username, priority),
    fetchBotBouncerStatus(username, priority),
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

  const summary = summarizeProfile(username, profile, {
    ...(botBouncerStatus ? { botBouncerStatus } : {}),
    ...(botBouncerCheckedAt != null ? { botBouncerCheckedAt } : {}),
    ...(extra.googleHarvest ? { googleHarvest: extra.googleHarvest } : {}),
    ...(extra.passiveHarvest ? { passiveHarvest: extra.passiveHarvest } : {}),
  });
  const activityData = extractActivityData(profile, REDDIT_FETCH_LIMIT);

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
// `persona` stays `unknown` because normalizePersona owns its validation.
interface ClaudeVerdictPayload {
  factors: Factor[];
  summary: string;
  persona: unknown;
  region: unknown;
  demographics: unknown;
}

function parseClaudeVerdict(rawText: string): ClaudeVerdictPayload {
  const extracted = extractJson(rawText);
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
export interface InvestigationLlmSelection {
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
export async function runOneDAnalysis(
  apiKey: string,
  profileSummary: ProfileSummary,
  avatarUrl: string | null = null,
  selection: InvestigationLlmSelection = {}
): Promise<OneDAnalysisResult> {
  const systemPrompt = assemblePrompt(ANALYSIS_PROMPT, profileSummary, {
    llmFactorKeys: LLM_FACTOR_KEYS,
    stripInputConditional: false,
  });
  const deterministicFactors = scoreDeterministicFactors(profileSummary);

  const { rawText, usage, model, costUsd } = await investigationCallLlm(
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
  const factors = mergeFactors(parsed.factors, deterministicFactors);
  const derived = computeVerdict(factors);

  return {
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
    summary: parsed.summary,
    persona: normalizePersona(parsed.persona),
    region: normalizeRegionInference(parsed.region),
    demographics: normalizeDemographics(parsed.demographics),
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
export async function investigateUser(
  username: string,
  apiKey: string,
  extra: GatherProfileExtra = {},
  selection: InvestigationLlmSelection = {}
): Promise<InvestigateUserResult> {
  const gathered = await gatherProfile(username, extra);
  const avatarUrl = extractSnoovatarUrl(gathered.raw);
  const analysisResult = await runOneDAnalysis(
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
export { extractSnoovatarUrl };

export {
  INVESTIGATION_CONCURRENCY,
  investigationSweepOrphans,
  investigationStart,
  investigationStartBatch,
  investigationAutoOnView,
  investigationMaybeAuto,
} from "./handlers.ts";
