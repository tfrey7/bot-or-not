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
  RedditProfile,
  Verdict,
} from "../../types.ts";
import { bonExtractJson } from "../../utils/json.ts";
import { bonNormalizePersona } from "../../utils/persona.ts";
import { bonExtractActivityData } from "../../utils/reddit_activity.ts";
import { bonComputeVerdict } from "../../verdict.ts";
import { bonCallClaude } from "./api.ts";
import {
  bonFetchBotBouncerStatus,
  bonFetchRedditActivity,
  bonFetchRedditProfile,
} from "./fetch.ts";
import { bonSummarizeProfile } from "./summarize.ts";

export interface GatherProfileExtra {
  botBouncerStatus?: BotBouncerStatus;
  botBouncerCheckedAt?: number | null;
}

export interface GatheredProfile {
  summary: ProfileSummary;
  activityData: ActivityData;
  raw: RedditProfile;
  botBouncerStatus: BotBouncerStatus;
  botBouncerCheckedAt: number | null;
}

export interface OneDAnalysisResult {
  verdict: Verdict;
  confidence: number;
  botProbability: number;
  summary: string;
  persona: Persona | null;
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
  return bonExtractActivityData(await bonFetchRedditActivity(username));
}

// Fetch + summarize the account once so the analyzer works from a
// single Reddit fetch per investigation.
export async function bonGatherProfile(
  username: string,
  extra: GatherProfileExtra = {}
): Promise<GatheredProfile> {
  const [raw, freshBotBouncerStatus] = await Promise.all([
    bonFetchRedditProfile(username),
    bonFetchBotBouncerStatus(username),
  ]);

  const botBouncerStatus: BotBouncerStatus =
    freshBotBouncerStatus || extra.botBouncerStatus || null;
  const botBouncerCheckedAt = freshBotBouncerStatus
    ? Date.now()
    : extra.botBouncerCheckedAt || null;

  const summary = bonSummarizeProfile(username, raw, {
    botBouncerStatus,
    botBouncerCheckedAt,
  });
  const activityData = bonExtractActivityData(raw);

  return {
    summary,
    activityData,
    raw,
    botBouncerStatus,
    botBouncerCheckedAt,
  };
}

// Runs the 1D bot↔human analysis against an already-built summary.
export async function bonRunOneDAnalysis(
  apiKey: string,
  profileSummary: ProfileSummary
): Promise<OneDAnalysisResult> {
  const { rawText, usage, model, webSearchCount, costUsd } =
    await bonCallClaude(
      apiKey,
      BON_ANALYSIS_PROMPT,
      profileSummary,
      "claude 1D",
      { webSearch: true }
    );

  const verdict = bonExtractJson(rawText) as {
    factors?: Factor[];
    summary?: string;
    persona?: unknown;
  } | null;

  if (!verdict) {
    throw new Error("Could not parse verdict JSON from Claude response");
  }

  const factors = Array.isArray(verdict.factors) ? verdict.factors : [];
  const derived = bonComputeVerdict(factors);

  return {
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
    summary: verdict.summary || "",
    persona: bonNormalizePersona(verdict.persona),
    factors,
    runAt: Date.now(),
    model,
    usage,
    webSearchCount: webSearchCount || 0,
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
}

// Single-call entry point: fetch the profile, run the 1D analyzer,
// return the combined investigation object.
export async function bonInvestigateUser(
  username: string,
  apiKey: string,
  extra: GatherProfileExtra = {}
): Promise<InvestigateUserResult> {
  const inputs = await bonGatherProfile(username, extra);
  const oneD = await bonRunOneDAnalysis(apiKey, inputs.summary);

  return {
    ...oneD,
    postsFetched: inputs.raw.submitted?.data?.children?.length || 0,
    commentsFetched: inputs.raw.comments?.data?.children?.length || 0,
    accountCreatedAt: inputs.summary.account.created_at,
    accountAgeDays: inputs.summary.account.age_days,
    activityData: inputs.activityData,
    botBouncerStatus: inputs.botBouncerStatus,
    botBouncerCheckedAt: inputs.botBouncerCheckedAt,
  };
}
