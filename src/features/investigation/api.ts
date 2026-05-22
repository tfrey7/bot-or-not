// Investigation-specific framing over the LLM provider. Wraps the
// profile summary JSON + optional Snoovatar image into a normalized
// `LlmCompleteRequest` and delegates the call to whichever provider the
// LLM layer hands back. Caching, retries, and provider auth all live
// below the seam in `src/llm/`.

import type { ClaudeUsage, ProfileSummary } from "../../types.ts";
import { bonCreateLlmProvider } from "../../llm/index.ts";
import type { LlmContentPart } from "../../llm/index.ts";
import { bonSerializeProfileForClaude } from "./summarize.ts";

const BON_INVESTIGATION_MAX_TOKENS = 4096;

export interface InvestigationLlmResult {
  rawText: string;
  usage: ClaudeUsage | null;
  model: string;
  costUsd: number | null;
}

// `avatarUrl` is the customized Snoovatar PNG URL. When set, the call
// attaches it as an image content part in front of the JSON text so the
// prompt's `avatar_style` factor can score it.
// `model` overrides the provider's default model for experimentation
// (see scripts/investigate.ts --model flag).
// `serialize` overrides the user-message serializer — by default we emit
// the compact columnar shape via bonSerializeProfileForClaude; the
// cost-experiment harness passes its own verbose serializer to A/B the
// two formats against the same summary.
export interface InvestigationLlmOptions {
  avatarUrl?: string | null;
  model?: string;
  serialize?: (summary: ProfileSummary) => string;
}

export async function bonInvestigationCallLlm(
  apiKey: string,
  systemPrompt: string,
  profileSummary: ProfileSummary,
  label = "investigation 1D",
  options: InvestigationLlmOptions = {}
): Promise<InvestigationLlmResult> {
  const provider = bonCreateLlmProvider(apiKey);
  const userContent: LlmContentPart[] = [];

  if (options.avatarUrl) {
    userContent.push({ kind: "image", url: options.avatarUrl });
  }

  const serialize = options.serialize ?? bonSerializeProfileForClaude;
  userContent.push({
    kind: "text",
    text:
      "Analyze the following Reddit account and return ONLY the JSON verdict object as specified in your instructions.\n\n```json\n" +
      serialize(profileSummary) +
      "\n```",
  });

  const result = await provider.complete({
    systemPrompt,
    userContent,
    maxTokens: BON_INVESTIGATION_MAX_TOKENS,
    label,
    ...(options.model ? { model: options.model } : {}),
  });

  return {
    rawText: result.text,
    usage: result.usage,
    model: result.model,
    costUsd: result.costUsd,
  };
}
