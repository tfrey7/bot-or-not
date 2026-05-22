// Anthropic Messages API implementation of `LlmProvider`. Owns:
//   - the URL / auth headers / `anthropic-version`
//   - `cache_control: ephemeral` on the system prompt (5-min cache; back-to-back
//     calls hit it at ~10% of input rate)
//   - the SSE stream parser used by `runToolLoop`
//   - translation between `LlmContentPart` / `LlmTool` and Anthropic's
//     content-block / tool shapes
//
// Nothing about Anthropic should leak above this module — callers see
// only the types in `provider.ts`.

import type { ClaudeUsage } from "../types.ts";
import { bonEstimateCostUsd } from "./cost.ts";
import { bonEnrichLlmError } from "./provider.ts";
import type {
  LlmAction,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmContentPart,
  LlmMessage,
  LlmModelOption,
  LlmProgressListener,
  LlmProvider,
  LlmTool,
  LlmToolLoopRequest,
  LlmToolLoopResult,
  LlmVendor,
} from "./provider.ts";

const BON_ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const BON_ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

const BON_ANTHROPIC_MODELS: readonly LlmModelOption[] = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];
const BON_ANTHROPIC_DEFAULT_COMPLETE_TIMEOUT_MS = 4 * 60 * 1000;
const BON_ANTHROPIC_DEFAULT_TOOL_TURN_TIMEOUT_MS = 60_000;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  [k: string]: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
}

function toAnthropicContent(parts: LlmContentPart[]): AnthropicContentBlock[] {
  return parts.map((part): AnthropicContentBlock => {
    switch (part.kind) {
      case "text":
        return { type: "text", text: part.text };
      case "image":
        return {
          type: "image",
          source: { type: "url", url: part.url },
        } as AnthropicContentBlock;
      case "tool-use":
        return {
          type: "tool_use",
          id: part.id,
          name: part.tool,
          input: part.input,
        };
      case "tool-result":
        return {
          type: "tool_result",
          tool_use_id: part.toolUseId,
          content: part.content,
        };
    }
  });
}

function fromAnthropicContent(
  blocks: AnthropicContentBlock[]
): LlmContentPart[] {
  const parts: LlmContentPart[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ kind: "text", text: block.text ?? "" });
    } else if (block.type === "tool_use") {
      parts.push({
        kind: "tool-use",
        id: block.id ?? "",
        tool: block.name ?? "",
        input: block.input ?? {},
      });
    }

    // Unknown / non-text non-tool blocks are dropped. Future Anthropic
    // block types won't break the loop — they just don't surface.
  }

  return parts;
}

function toAnthropicMessage(message: LlmMessage): AnthropicMessage {
  return {
    role: message.role,
    content: toAnthropicContent(message.content),
  };
}

function toAnthropicTool(tool: LlmTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly vendor: LlmVendor = "anthropic";
  readonly defaultModel = BON_ANTHROPIC_DEFAULT_MODEL;
  readonly availableModels = BON_ANTHROPIC_MODELS;

  constructor(private readonly apiKey: string) {}

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const {
      systemPrompt,
      userContent,
      maxTokens,
      model = this.defaultModel,
      label = "anthropic",
      timeoutMs = BON_ANTHROPIC_DEFAULT_COMPLETE_TIMEOUT_MS,
    } = request;

    const startedAt = performance.now();

    const body = {
      model,
      max_tokens: maxTokens,
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
          content: toAnthropicContent(userContent),
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(BON_ANTHROPIC_API_URL, {
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
      throw bonEnrichLlmError(
        new Error(
          `Anthropic API ${response.status}: ${errorText.slice(0, 300)}`
        ),
        response
      );
    }

    const payload = (await response.json()) as AnthropicResponse;
    const blocks = payload.content ?? [];
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");

    const elapsedMs = Math.round(performance.now() - startedAt);
    const inputTokens = payload.usage?.input_tokens ?? "?";
    const outputTokens = payload.usage?.output_tokens ?? "?";
    const resolvedModel = payload.model ?? model;
    const costUsd = bonEstimateCostUsd(payload.usage, resolvedModel);
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

  async runToolLoop(request: LlmToolLoopRequest): Promise<LlmToolLoopResult> {
    const {
      systemPrompt,
      tools,
      messages: inboundMessages,
      dispatch,
      maxTokens,
      maxTurns,
      onProgress,
      signal,
      model = this.defaultModel,
      label = "anthropic-tool-loop",
      timeoutMs = BON_ANTHROPIC_DEFAULT_TOOL_TURN_TIMEOUT_MS,
    } = request;

    const startedAt = performance.now();
    const messages: AnthropicMessage[] =
      inboundMessages.map(toAnthropicMessage);
    const actions: LlmAction[] = [];
    const anthropicTools = tools.map(toAnthropicTool);
    let totalCostUsd: number | null = null;
    let lastModel = model;
    let lastUsage: ClaudeUsage | null = null;
    let finalText = "";

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        return {
          history: messages.map(fromAnthropicMessage),
          actions,
          finalText: finalText || "Cancelled.",
          stopReason: "aborted",
          usage: lastUsage,
          model: lastModel,
          costUsd: totalCostUsd,
          aborted: true,
          maxTurnsExceeded: false,
        };
      }

      onProgress?.({ kind: "turn-start", turn });

      const turnResult = await this.streamTurn({
        systemPrompt,
        anthropicTools,
        messages,
        model,
        maxTokens,
        timeoutMs,
        turn,
        onProgress,
        externalSignal: signal,
      });

      lastModel = turnResult.model;
      lastUsage = turnResult.usage;
      onProgress?.({ kind: "model", model: turnResult.model });

      if (turnResult.costUsd !== null) {
        totalCostUsd = (totalCostUsd ?? 0) + turnResult.costUsd;
        onProgress?.({ kind: "cost", costUsd: totalCostUsd });
      }

      const blocks = turnResult.content;
      messages.push({ role: "assistant", content: blocks });

      const textBlocks = blocks.filter((b) => b.type === "text");
      const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");

      if (textBlocks.length > 0) {
        finalText = textBlocks
          .map((b) => b.text ?? "")
          .join("\n")
          .trim();
      }

      if (toolUseBlocks.length === 0 || turnResult.stopReason !== "tool_use") {
        const elapsedMs = Math.round(performance.now() - startedAt);
        console.log(
          `[Bot or Not] timing: ${label} ${elapsedMs}ms (${actions.length} actions)`
        );

        return {
          history: messages.map(fromAnthropicMessage),
          actions,
          finalText: finalText || "Done.",
          stopReason: turnResult.stopReason,
          usage: lastUsage,
          model: lastModel,
          costUsd: totalCostUsd,
          aborted: false,
          maxTurnsExceeded: false,
        };
      }

      const toolResultBlocks: AnthropicContentBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name ?? "";
        const toolInput = toolUse.input ?? {};
        const toolUseId = toolUse.id ?? "";

        onProgress?.({
          kind: "tool-use-input",
          turn,
          id: toolUseId,
          tool: toolName,
          input: toolInput,
        });

        let result: { ok: boolean; error?: string; [k: string]: unknown };
        try {
          result = await dispatch(toolName, toolInput);
        } catch (error) {
          result = {
            ok: false,
            error: String((error as { message?: string })?.message ?? error),
          };
        }

        actions.push({
          tool: toolName,
          input: toolInput,
          ok: !!result.ok,
          ...(result.ok
            ? { result }
            : { error: result.error ?? "unknown error" }),
        });

        onProgress?.({
          kind: "tool-use-end",
          turn,
          id: toolUseId,
          tool: toolName,
          ok: !!result.ok,
          result: result.ok ? result : undefined,
          error: result.ok ? undefined : (result.error ?? "unknown error"),
        });

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    return {
      history: messages.map(fromAnthropicMessage),
      actions,
      finalText: finalText || "Command exceeded the maximum number of turns.",
      stopReason: "max_turns",
      usage: lastUsage,
      model: lastModel,
      costUsd: totalCostUsd,
      aborted: false,
      maxTurnsExceeded: true,
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

  private async streamTurn(opts: {
    systemPrompt: string;
    anthropicTools: Array<Record<string, unknown>>;
    messages: AnthropicMessage[];
    model: string;
    maxTokens: number;
    timeoutMs: number;
    turn: number;
    onProgress: LlmProgressListener | undefined;
    externalSignal: AbortSignal | undefined;
  }): Promise<{
    content: AnthropicContentBlock[];
    stopReason: string;
    costUsd: number | null;
    model: string;
    usage: ClaudeUsage | null;
  }> {
    const {
      systemPrompt,
      anthropicTools,
      messages,
      model,
      maxTokens,
      timeoutMs,
      turn,
      onProgress,
      externalSignal,
    } = opts;

    const body = {
      model,
      max_tokens: maxTokens,
      stream: true,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: anthropicTools,
      messages,
    };

    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    };

    let response: Response;
    try {
      response = await fetch(BON_ANTHROPIC_API_URL, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      cleanup();
      if ((error as { name?: string })?.name === "AbortError") {
        if (externalSignal?.aborted) {
          throw new Error("tool-loop aborted by caller", { cause: error });
        }

        throw new Error(`Anthropic API timed out after ${timeoutMs / 1000}s`, {
          cause: error,
        });
      }

      throw error;
    }

    if (!response.ok) {
      cleanup();
      const errorText = await response.text().catch(() => "");
      throw bonEnrichLlmError(
        new Error(
          `Anthropic API ${response.status}: ${errorText.slice(0, 300)}`
        ),
        response
      );
    }

    const blocks = new Map<number, StreamingBlock>();
    let stopReason = "end_turn";
    let usage: ClaudeUsage | null = null;
    let streamModel = model;

    const reader = response.body?.getReader();
    if (!reader) {
      cleanup();
      throw new Error("Anthropic API returned empty body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      // Parse the Anthropic SSE event stream. Each event is
      // `event: <name>\ndata: <json>\n\n` (blank line terminates). We only
      // care about `data:` lines — the event-name line is informational and
      // the JSON includes the same `type` field.
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let eolIndex: number;

        while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
          const rawEvent = buffer.slice(0, eolIndex);
          buffer = buffer.slice(eolIndex + 2);

          const dataLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("data: "));

          if (!dataLine) {
            continue;
          }

          const dataStr = dataLine.slice(6).trim();
          if (!dataStr) {
            continue;
          }

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const eventType = payload.type as string | undefined;

          if (eventType === "message_start") {
            const message = payload.message as
              | { model?: string; usage?: ClaudeUsage }
              | undefined;
            streamModel = message?.model ?? streamModel;
            usage = message?.usage ?? null;
          } else if (eventType === "content_block_start") {
            const idx = payload.index as number;
            const cb = payload.content_block as
              | {
                  type: string;
                  text?: string;
                  id?: string;
                  name?: string;
                }
              | undefined;

            if (cb) {
              blocks.set(idx, {
                type: cb.type,
                text: cb.type === "text" ? (cb.text ?? "") : "",
                id: cb.id ?? "",
                name: cb.name ?? "",
                inputJson: "",
              });

              if (cb.type === "tool_use") {
                onProgress?.({
                  kind: "tool-use-start",
                  turn,
                  id: cb.id ?? "",
                  tool: cb.name ?? "",
                });
              }
            }
          } else if (eventType === "content_block_delta") {
            const idx = payload.index as number;
            const block = blocks.get(idx);
            if (!block) {
              continue;
            }

            const delta = payload.delta as
              | { type: string; text?: string; partial_json?: string }
              | undefined;

            if (delta?.type === "text_delta") {
              const chunk = delta.text ?? "";
              block.text += chunk;
              if (chunk) {
                onProgress?.({
                  kind: "assistant-text-delta",
                  turn,
                  text: chunk,
                });
              }
            } else if (delta?.type === "input_json_delta") {
              block.inputJson += delta.partial_json ?? "";
            }
          } else if (eventType === "message_delta") {
            const delta = payload.delta as { stop_reason?: string } | undefined;

            if (delta?.stop_reason) {
              stopReason = delta.stop_reason;
            }

            const deltaUsage = payload.usage as ClaudeUsage | undefined;
            if (deltaUsage) {
              usage = { ...(usage ?? {}), ...deltaUsage };
            }
          }
        }
      }
    } finally {
      cleanup();
    }

    // Materialize content blocks in index order. tool_use inputs are
    // reassembled from streamed JSON chunks here — partial_json is always
    // a valid prefix of the final input, so the parse only happens once
    // we've seen content_block_stop.
    const sortedIndices = Array.from(blocks.keys()).sort((a, b) => a - b);
    const content: AnthropicContentBlock[] = sortedIndices.map((idx) => {
      const block = blocks.get(idx) as StreamingBlock;
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }

      if (block.type === "tool_use") {
        let parsed: Record<string, unknown> = {};
        const raw = block.inputJson.trim();
        if (raw) {
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parsed = {};
          }
        }

        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: parsed,
        };
      }

      return { type: block.type };
    });

    const costUsd = bonEstimateCostUsd(usage, streamModel);

    return { content, stopReason, costUsd, model: streamModel, usage };
  }
}

// In-flight block while we stream. Index = position in the model's
// content array. text accumulates from text_delta; inputJson accumulates
// from input_json_delta and is parsed once at the end.
interface StreamingBlock {
  type: string;
  text: string;
  id: string;
  name: string;
  inputJson: string;
}

function fromAnthropicMessage(message: AnthropicMessage): LlmMessage {
  return {
    role: message.role,
    content: fromAnthropicContent(message.content),
  };
}
