// OpenAI Chat Completions implementation of `LlmProvider`. Owns:
//   - the URL / auth headers
//   - translation between `LlmContentPart` and OpenAI's chat-message
//     content shapes
//   - mapping OpenAI's `usage` into our `ClaudeUsage` shape so cost.ts
//     stays the single source of truth for pricing math
//
// Nothing about OpenAI should leak above this module — callers see
// only the types in `provider.ts`.

import type { ClaudeUsage } from "../types.ts";
import { estimateCostUsd } from "./cost.ts";
import { enrichLlmError } from "./provider.ts";
import type {
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmContentPart,
  LlmModelOption,
  LlmProvider,
  LlmVendor,
} from "./provider.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_DEFAULT_COMPLETE_TIMEOUT_MS = 4 * 60 * 1000;

const OPENAI_MODELS: readonly LlmModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenAIChoice {
  message?: {
    role: string;
    content: string | null;
  };
  finish_reason?: string;
}

interface OpenAIResponse {
  model?: string;
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
}

function toOpenAIUserContent(
  parts: LlmContentPart[]
): Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
> {
  const out: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  for (const part of parts) {
    if (part.kind === "text") {
      out.push({ type: "text", text: part.text });
    } else if (part.kind === "image") {
      out.push({ type: "image_url", image_url: { url: part.url } });
    }
  }

  return out;
}

// OpenAI returns `prompt_tokens` inclusive of any cached prefix. To make
// `cost.ts` charge the cache discount correctly, split the cached portion
// off into `cache_read_input_tokens` so it gets billed at the cacheRead
// rate. OpenAI has no explicit cache-write fee — caching is automatic.
function toClaudeUsage(usage: OpenAIUsage | undefined): ClaudeUsage | null {
  if (!usage) {
    return null;
  }

  const promptTokens = usage.prompt_tokens ?? 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;

  return {
    input_tokens: Math.max(promptTokens - cachedTokens, 0),
    output_tokens: usage.completion_tokens ?? 0,
    cache_read_input_tokens: cachedTokens,
    cache_creation_input_tokens: 0,
  };
}

export class OpenAIProvider implements LlmProvider {
  readonly vendor: LlmVendor = "openai";
  readonly defaultModel = OPENAI_DEFAULT_MODEL;
  readonly availableModels = OPENAI_MODELS;

  constructor(private readonly apiKey: string) {}

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const {
      systemPrompt,
      userContent,
      maxTokens,
      model = this.defaultModel,
      label = "openai",
      timeoutMs = OPENAI_DEFAULT_COMPLETE_TIMEOUT_MS,
    } = request;

    const startedAt = performance.now();

    const body = {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: toOpenAIUserContent(userContent) },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms (failed)`);

      if ((error as { name?: string })?.name === "AbortError") {
        throw new Error(`OpenAI API timed out after ${timeoutMs / 1000}s`, {
          cause: error,
        });
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
      throw enrichLlmError(
        new Error(`OpenAI API ${response.status}: ${errorText.slice(0, 300)}`),
        response
      );
    }

    const payload = (await response.json()) as OpenAIResponse;
    const text = payload.choices?.[0]?.message?.content ?? "";

    const usage = toClaudeUsage(payload.usage);
    const resolvedModel = payload.model ?? model;
    const costUsd = estimateCostUsd(usage, resolvedModel);

    const elapsedMs = Math.round(performance.now() - startedAt);
    const inputTokens = payload.usage?.prompt_tokens ?? "?";
    const outputTokens = payload.usage?.completion_tokens ?? "?";
    const costString = costUsd !== null ? ` $${costUsd.toFixed(4)}` : "";

    console.log(
      `[Bot or Not] timing: ${label} ${elapsedMs}ms (in=${inputTokens} out=${outputTokens})${costString}`
    );

    return {
      text,
      usage,
      model: resolvedModel,
      costUsd,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
