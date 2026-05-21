// Thin wrapper over the Anthropic Messages API. Marks the system prompt
// for ephemeral (5-min) caching since it's byte-identical across runs;
// back-to-back investigations within ~5 min hit the cache at ~10% of the
// input rate. The profile summary already carries `web_search_results`
// from our own DuckDuckGo fetch (see src/features/web-search/) — Claude
// reads them as plain data, no server-side search tool needed.

import type { ClaudeUsage, ProfileSummary } from "../../types.ts";
import { bonEstimateCostUsd } from "../../utils/cost.ts";
import { bonSerializeProfileForClaude } from "./summarize.ts";

const BON_CLAUDE_MODEL = "claude-sonnet-4-6";
const BON_CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// Hard ceiling on the Claude call. Anything past this is a hung
// connection, not a slow one.
const BON_CLAUDE_TIMEOUT_MS = 4 * 60 * 1000;

export interface ClaudeCallResult {
  rawText: string;
  usage: ClaudeUsage | null;
  model: string;
  costUsd: number | null;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
}

// `avatarUrl` is the customized Snoovatar PNG URL. When set, the call
// attaches it as an image content block in front of the JSON text so the
// prompt's `avatar_style` factor can score it.
// `model` overrides the default model id for experimentation (see
// scripts/investigate.ts --model flag).
// `serialize` overrides the user-message serializer — by default we emit
// the compact columnar shape via bonSerializeProfileForClaude; the
// cost-experiment harness passes its own verbose serializer to A/B the
// two formats against the same summary.
export interface ClaudeCallOptions {
  avatarUrl?: string | null;
  model?: string;
  serialize?: (summary: ProfileSummary) => string;
}

export async function bonCallClaude(
  apiKey: string,
  systemPrompt: string,
  profileSummary: ProfileSummary,
  label = "claude",
  options: ClaudeCallOptions = {}
): Promise<ClaudeCallResult> {
  const startedAt = performance.now();

  const userContent: Array<Record<string, unknown>> = [];

  if (options.avatarUrl) {
    userContent.push({
      type: "image",
      source: { type: "url", url: options.avatarUrl },
    });
  }

  const serialize = options.serialize ?? bonSerializeProfileForClaude;
  userContent.push({
    type: "text",
    text:
      "Analyze the following Reddit account and return ONLY the JSON verdict object as specified in your instructions.\n\n```json\n" +
      serialize(profileSummary) +
      "\n```",
  });

  const body: Record<string, unknown> = {
    model: options.model ?? BON_CLAUDE_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BON_CLAUDE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(BON_CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms (failed)`);

    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error(
        `Claude API timed out after ${BON_CLAUDE_TIMEOUT_MS / 1000}s`,
        { cause: error }
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(
      `[Bot or Not] timing: ${label} ${elapsedMs}ms (${response.status})`
    );
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Claude API ${response.status}: ${errorText.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as ClaudeResponse;
  const blocks = payload.content ?? [];
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

  const elapsedMs = Math.round(performance.now() - startedAt);
  const inputTokens = payload.usage?.input_tokens ?? "?";
  const outputTokens = payload.usage?.output_tokens ?? "?";
  const model = payload.model ?? options.model ?? BON_CLAUDE_MODEL;
  const costUsd = bonEstimateCostUsd(payload.usage, model);
  const costString = costUsd !== null ? ` $${costUsd.toFixed(4)}` : "";

  console.log(
    `[Bot or Not] timing: ${label} ${elapsedMs}ms (in=${inputTokens} out=${outputTokens})${costString}`
  );

  return {
    rawText: text,
    usage: payload.usage ?? null,
    model,
    costUsd,
  };
}
