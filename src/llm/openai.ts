// OpenAI Chat Completions implementation of `LlmProvider`. Owns:
//   - the URL / auth headers
//   - translation between `LlmContentPart` / `LlmTool` and OpenAI's
//     chat-message / function-call shapes (in particular: assistant
//     tool calls live on a sibling `tool_calls` field, and tool results
//     are their own `role: "tool"` messages — not inline content parts)
//   - the SSE stream parser used by `runToolLoop`
//   - mapping OpenAI's `usage` into our `ClaudeUsage` shape so cost.ts
//     stays the single source of truth for pricing math
//
// Nothing about OpenAI should leak above this module — callers see
// only the types in `provider.ts`.

import type { ClaudeUsage } from "../types.ts";
import { bonEstimateCostUsd } from "./cost.ts";
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

const BON_OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const BON_OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const BON_OPENAI_DEFAULT_COMPLETE_TIMEOUT_MS = 4 * 60 * 1000;
const BON_OPENAI_DEFAULT_TOOL_TURN_TIMEOUT_MS = 60_000;

const BON_OPENAI_MODELS: readonly LlmModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OpenAIChatMessage =
  | {
      role: "system";
      content: string;
    }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

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
    tool_calls?: OpenAIToolCall[];
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

// Translate a normalized LlmMessage into one or more OpenAI chat
// messages. Assistant messages with tool_use parts collapse to a single
// assistant message with a `tool_calls` array; user messages with
// tool_result parts expand into one `role: "tool"` message per result.
function expandToOpenAIMessages(message: LlmMessage): OpenAIChatMessage[] {
  if (message.role === "assistant") {
    const text = message.content
      .filter(
        (part): part is { kind: "text"; text: string } => part.kind === "text"
      )
      .map((part) => part.text)
      .join("");

    const toolCalls = message.content
      .filter(
        (
          part
        ): part is {
          kind: "tool-use";
          id: string;
          tool: string;
          input: Record<string, unknown>;
        } => part.kind === "tool-use"
      )
      .map(
        (part): OpenAIToolCall => ({
          id: part.id,
          type: "function",
          function: {
            name: part.tool,
            arguments: JSON.stringify(part.input ?? {}),
          },
        })
      );

    const out: OpenAIChatMessage = {
      role: "assistant",
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };

    return [out];
  }

  // user role: split off any tool-result parts into separate `tool`
  // messages, since OpenAI requires that shape. Anything else (text,
  // image) stays grouped under one user message.
  const toolResults = message.content.filter(
    (
      part
    ): part is { kind: "tool-result"; toolUseId: string; content: string } =>
      part.kind === "tool-result"
  );

  const userParts = message.content.filter(
    (part) => part.kind === "text" || part.kind === "image"
  );

  const out: OpenAIChatMessage[] = toolResults.map((part) => ({
    role: "tool",
    tool_call_id: part.toolUseId,
    content: part.content,
  }));

  if (userParts.length > 0) {
    out.push({
      role: "user",
      content: toOpenAIUserContent(userParts),
    });
  }

  return out;
}

function toOpenAITool(tool: LlmTool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
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
  readonly defaultModel = BON_OPENAI_DEFAULT_MODEL;
  readonly availableModels = BON_OPENAI_MODELS;

  constructor(private readonly apiKey: string) {}

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const {
      systemPrompt,
      userContent,
      maxTokens,
      model = this.defaultModel,
      label = "openai",
      timeoutMs = BON_OPENAI_DEFAULT_COMPLETE_TIMEOUT_MS,
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
      response = await fetch(BON_OPENAI_API_URL, {
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
      throw new Error(
        `OpenAI API ${response.status}: ${errorText.slice(0, 300)}`
      );
    }

    const payload = (await response.json()) as OpenAIResponse;
    const text = payload.choices?.[0]?.message?.content ?? "";

    const usage = toClaudeUsage(payload.usage);
    const resolvedModel = payload.model ?? model;
    const costUsd = bonEstimateCostUsd(usage, resolvedModel);

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
      label = "openai-tool-loop",
      timeoutMs = BON_OPENAI_DEFAULT_TOOL_TURN_TIMEOUT_MS,
    } = request;

    const startedAt = performance.now();

    // Maintain two parallel transcripts: the OpenAI-shaped log we send on
    // the wire each turn, and the normalized log we hand back to the
    // caller. The normalized log feeds back into runToolLoop on the next
    // operator input — keeping it canonical means the conversation
    // survives swapping providers mid-session.
    const openaiMessages: OpenAIChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...inboundMessages.flatMap(expandToOpenAIMessages),
    ];
    const normalizedHistory: LlmMessage[] = inboundMessages.slice();
    const actions: LlmAction[] = [];
    const openaiTools = tools.map(toOpenAITool);

    let totalCostUsd: number | null = null;
    let lastModel = model;
    let lastUsage: ClaudeUsage | null = null;
    let finalText = "";

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        return {
          history: normalizedHistory,
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
        openaiTools,
        openaiMessages,
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

      const assistantContent = turnResult.text;
      const assistantToolCalls = turnResult.toolCalls;

      // Mirror the assistant turn into both transcripts.
      const assistantOpenAIMessage: OpenAIChatMessage = {
        role: "assistant",
        content: assistantContent || null,
        ...(assistantToolCalls.length > 0
          ? { tool_calls: assistantToolCalls }
          : {}),
      };
      openaiMessages.push(assistantOpenAIMessage);

      const normalizedAssistant: LlmMessage = {
        role: "assistant",
        content: [
          ...(assistantContent
            ? [{ kind: "text" as const, text: assistantContent }]
            : []),
          ...assistantToolCalls.map(
            (tc) =>
              ({
                kind: "tool-use" as const,
                id: tc.id,
                tool: tc.function.name,
                input: safeParseJsonObject(tc.function.arguments),
              }) satisfies LlmContentPart
          ),
        ],
      };
      normalizedHistory.push(normalizedAssistant);

      if (assistantContent) {
        finalText = assistantContent.trim();
      }

      if (
        assistantToolCalls.length === 0 ||
        (turnResult.finishReason !== "tool_calls" &&
          turnResult.finishReason !== null)
      ) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        console.log(
          `[Bot or Not] timing: ${label} ${elapsedMs}ms (${actions.length} actions)`
        );

        return {
          history: normalizedHistory,
          actions,
          finalText: finalText || "Done.",
          stopReason: turnResult.finishReason ?? "stop",
          usage: lastUsage,
          model: lastModel,
          costUsd: totalCostUsd,
          aborted: false,
          maxTurnsExceeded: false,
        };
      }

      const toolResultParts: LlmContentPart[] = [];

      for (const toolCall of assistantToolCalls) {
        const toolName = toolCall.function.name;
        const toolInput = safeParseJsonObject(toolCall.function.arguments);
        const toolUseId = toolCall.id;

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

        const serialized = JSON.stringify(result);

        openaiMessages.push({
          role: "tool",
          tool_call_id: toolUseId,
          content: serialized,
        });

        toolResultParts.push({
          kind: "tool-result",
          toolUseId,
          content: serialized,
        });
      }

      normalizedHistory.push({ role: "user", content: toolResultParts });
    }

    return {
      history: normalizedHistory,
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
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async streamTurn(opts: {
    openaiTools: Array<Record<string, unknown>>;
    openaiMessages: OpenAIChatMessage[];
    model: string;
    maxTokens: number;
    timeoutMs: number;
    turn: number;
    onProgress: LlmProgressListener | undefined;
    externalSignal: AbortSignal | undefined;
  }): Promise<{
    text: string;
    toolCalls: OpenAIToolCall[];
    finishReason: string | null;
    costUsd: number | null;
    model: string;
    usage: ClaudeUsage | null;
  }> {
    const {
      openaiTools,
      openaiMessages,
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
      stream_options: { include_usage: true },
      tools: openaiTools,
      messages: openaiMessages,
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
      response = await fetch(BON_OPENAI_API_URL, {
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

        throw new Error(`OpenAI API timed out after ${timeoutMs / 1000}s`, {
          cause: error,
        });
      }

      throw error;
    }

    if (!response.ok) {
      cleanup();
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI API ${response.status}: ${errorText.slice(0, 300)}`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      cleanup();
      throw new Error("OpenAI API returned empty body");
    }

    // Accumulators for streamed pieces. text and per-index tool-call
    // fragments come in arbitrary order across chunks; index correlates
    // them within this turn.
    let text = "";
    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string; emittedStart: boolean }
    >();
    let finishReason: string | null = null;
    let usage: OpenAIUsage | undefined;
    let streamModel = model;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
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
          if (!dataStr || dataStr === "[DONE]") {
            continue;
          }

          let payload: {
            model?: string;
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: OpenAIUsage;
          };

          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (payload.model) {
            streamModel = payload.model;
          }

          if (payload.usage) {
            usage = payload.usage;
          }

          const choice = payload.choices?.[0];
          if (!choice) {
            continue;
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (!delta) {
            continue;
          }

          if (typeof delta.content === "string" && delta.content.length > 0) {
            text += delta.content;
            onProgress?.({
              kind: "assistant-text-delta",
              turn,
              text: delta.content,
            });
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const fragment of delta.tool_calls) {
              const idx = fragment.index;
              const existing = toolCalls.get(idx) ?? {
                id: "",
                name: "",
                arguments: "",
                emittedStart: false,
              };

              if (fragment.id) {
                existing.id = fragment.id;
              }

              if (fragment.function?.name) {
                existing.name += fragment.function.name;
              }

              if (fragment.function?.arguments) {
                existing.arguments += fragment.function.arguments;
              }

              if (!existing.emittedStart && existing.id && existing.name) {
                existing.emittedStart = true;
                onProgress?.({
                  kind: "tool-use-start",
                  turn,
                  id: existing.id,
                  tool: existing.name,
                });
              }

              toolCalls.set(idx, existing);
            }
          }
        }
      }
    } finally {
      cleanup();
    }

    const claudeUsage = toClaudeUsage(usage);
    const costUsd = bonEstimateCostUsd(claudeUsage, streamModel);

    const sortedToolCalls = Array.from(toolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(
        ([, tc]): OpenAIToolCall => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })
      );

    return {
      text,
      toolCalls: sortedToolCalls,
      finishReason,
      costUsd,
      model: streamModel,
      usage: claudeUsage,
    };
  }
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  return {};
}
