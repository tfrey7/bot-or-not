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
  ContextItem,
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

// Caller-supplied context for an investigation. All three keys are
// independently optional — omit when no signal is on hand. The fields
// themselves never carry `null`; absence is expressed by omission.
export interface GatherProfileExtra {
  botBouncerStatus?: Exclude<BotBouncerStatus, null>;
  botBouncerCheckedAt?: number;
  contextItems?: ContextItem[];
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
    freshBotBouncerStatus ?? extra.botBouncerStatus ?? null;
  const botBouncerCheckedAt: number | null = freshBotBouncerStatus
    ? Date.now()
    : (extra.botBouncerCheckedAt ?? null);

  const summary = bonSummarizeProfile(username, raw, {
    ...(botBouncerStatus ? { botBouncerStatus } : {}),
    ...(botBouncerCheckedAt != null ? { botBouncerCheckedAt } : {}),
    contextItems: extra.contextItems,
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

// Shape of the JSON object Claude returns. The prompt mandates every field;
// parseClaudeVerdict throws if anything is missing. Downstream code can trust
// the shape — no defensive `?? ""` / `Array.isArray()` checks anywhere else.
// `persona` stays `unknown` because bonNormalizePersona owns its validation.
interface ClaudeVerdictPayload {
  factors: Factor[];
  summary: string;
  persona: unknown;
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

  const parsed = parseClaudeVerdict(rawText);
  const derived = bonComputeVerdict(parsed.factors);

  return {
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
    summary: parsed.summary,
    persona: bonNormalizePersona(parsed.persona),
    factors: parsed.factors,
    runAt: Date.now(),
    model,
    usage,
    webSearchCount,
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
  const gathered = await bonGatherProfile(username, extra);
  const analysisResult = await bonRunOneDAnalysis(apiKey, gathered.summary);

  return {
    ...analysisResult,
    postsFetched: gathered.raw.submitted.data?.children?.length ?? 0,
    commentsFetched: gathered.raw.comments.data?.children?.length ?? 0,
    accountCreatedAt: gathered.summary.account.created_at,
    accountAgeDays: gathered.summary.account.age_days,
    activityData: gathered.activityData,
    botBouncerStatus: gathered.botBouncerStatus,
    botBouncerCheckedAt: gathered.botBouncerCheckedAt,
  };
}
