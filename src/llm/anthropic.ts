// Anthropic Messages API implementation of `LlmProvider`. Owns:
//   - the URL / auth headers / `anthropic-version`
//   - `cache_control: ephemeral` on the system prompt with the 1h TTL —
//     investigation queues commonly leave gaps wider than 5m, and the
//     1.6× write premium pays for itself after a single subsequent hit
//   - translation between `LlmContentPart` and Anthropic's content-block
//     shapes
//
// Nothing about Anthropic should leak above this module — callers see
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

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

const ANTHROPIC_MODELS: readonly LlmModelOption[] = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];
const ANTHROPIC_DEFAULT_COMPLETE_TIMEOUT_MS = 4 * 60 * 1000;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
  stop_reason?: string;
}

function toAnthropicContent(parts: LlmContentPart[]): AnthropicContentBlock[] {
  return parts.map((part): AnthropicContentBlock => {
    if (part.kind === "text") {
      return { type: "text", text: part.text };
    }

    return {
      type: "image",
      source: { type: "url", url: part.url },
    };
  });
}

export class AnthropicProvider implements LlmProvider {
  readonly vendor: LlmVendor = "anthropic";
  readonly defaultModel = ANTHROPIC_DEFAULT_MODEL;
  readonly availableModels = ANTHROPIC_MODELS;

  constructor(private readonly apiKey: string) {}

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const {
      systemPrompt,
      userContent,
      maxTokens,
      model = this.defaultModel,
      label = "anthropic",
      timeoutMs = ANTHROPIC_DEFAULT_COMPLETE_TIMEOUT_MS,
    } = request;

    const startedAt = performance.now();

    const body = {
      model,
      max_tokens: maxTokens,

      // Sonnet 5 runs adaptive thinking when the field is omitted; thinking
      // tokens would eat into max_tokens and can truncate the JSON output.
      thinking: { type: "disabled" },
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        {
          role: "user",
          content: toAnthropicContent(userContent),
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms (failed)`);

      if ((error as { name?: string })?.name === "AbortError") {
        throw new Error(`Anthropic API timed out after ${timeoutMs / 1000}s`, {
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
        new Error(
          `Anthropic API ${response.status}: ${errorText.slice(0, 300)}`
        ),
        response
      );
    }

    const payload = (await response.json()) as AnthropicResponse;

    // A max_tokens cutoff would otherwise surface downstream as a
    // misleading "could not parse verdict JSON".
    if (payload.stop_reason === "max_tokens") {
      throw new Error(
        `Anthropic response truncated at max_tokens (${label}) — raise the token cap or trim the prompt`
      );
    }

    const blocks = payload.content ?? [];
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");

    const elapsedMs = Math.round(performance.now() - startedAt);
    const inputTokens = payload.usage?.input_tokens ?? "?";
    const outputTokens = payload.usage?.output_tokens ?? "?";
    const resolvedModel = payload.model ?? model;
    const costUsd = estimateCostUsd(payload.usage, resolvedModel);
    const costString = costUsd !== null ? ` $${costUsd.toFixed(4)}` : "";

    console.log(
      `[Bot or Not] timing: ${label} ${elapsedMs}ms (in=${inputTokens} out=${outputTokens})${costString}`
    );

    return {
      text,
      usage: payload.usage ?? null,
      model: resolvedModel,
      costUsd,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
}
