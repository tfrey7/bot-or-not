// Tool-use loop against the Claude Messages API SSE stream. Hands the
// operator's natural-language command to Claude along with a slim snapshot of
// the reports store; Claude picks tools and we dispatch them via the
// caller-provided `dispatch` callback (background.ts routes those to the same
// handler functions onMessage uses). The optional `onProgress` callback fires
// for each streamed event so the UI can show a live action log and stream the
// assistant's prose reply token-by-token.

import type { ClaudeUsage } from "../../types.ts";
import { bonEstimateCostUsd } from "../../utils/cost.ts";
import BON_AI_COMMAND_PROMPT from "./prompt.md?raw";
import { BON_AI_COMMAND_TOOLS } from "./tools.ts";

const BON_AI_COMMAND_MODEL = "claude-sonnet-4-6";
const BON_AI_COMMAND_API_URL = "https://api.anthropic.com/v1/messages";
const BON_AI_COMMAND_TIMEOUT_MS = 60_000;
const BON_AI_COMMAND_MAX_TURNS = 8;

export interface AiCommandAction {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// Streaming events the agent emits as it works. The modal stitches these
// together into a live action log + token-streamed reply. Kinds:
//  - turn-start          : about to call the model (so the UI can show a
//                          "thinking" pip even before any text arrives)
//  - model               : echoed model id from the API response
//  - assistant-text-delta: incremental text chunk to append to the prose pane
//  - tool-use-start      : Claude opened a tool block (we have name+id but
//                          input is still being streamed)
//  - tool-use-input      : full input has been parsed; about to dispatch
//  - tool-use-end        : dispatch returned (result on success, error on fail)
//  - cost                : running total cost in USD after this turn's usage
export type AiCommandProgressEvent =
  | { kind: "turn-start"; turn: number }
  | { kind: "model"; model: string }
  | { kind: "assistant-text-delta"; turn: number; text: string }
  | { kind: "tool-use-start"; turn: number; id: string; tool: string }
  | {
      kind: "tool-use-input";
      turn: number;
      id: string;
      tool: string;
      input: Record<string, unknown>;
    }
  | {
      kind: "tool-use-end";
      turn: number;
      id: string;
      tool: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | { kind: "cost"; costUsd: number | null };

export type AiCommandProgress = (event: AiCommandProgressEvent) => void;

export interface AiCommandResult {
  ok: boolean;
  summary: string;
  actions: AiCommandAction[];
  costUsd: number | null;
  model: string;

  // Full message history after this turn, including the operator's input,
  // any tool_use / tool_result blocks, and the assistant's final reply. Hand
  // it back on the next call to make follow-ups conversational. Opaque to
  // callers — the agent module owns the schema.
  history: AiCommandMessage[];
  error?: string;
}

// Opaque conversation type. Callers (background.ts) store and pass it back
// without inspecting its contents.
export type AiCommandMessage = ClaudeMessage;

export type AiCommandDispatch = (
  tool: string,
  input: Record<string, unknown>
) => Promise<{ ok: boolean; error?: string; [k: string]: unknown }>;

export interface BonRunAiCommandOptions {
  history?: AiCommandMessage[];
  onProgress?: AiCommandProgress;
  signal?: AbortSignal;
}

// Inbound blocks from Claude. `tool_use` blocks carry id/name/input; text blocks
// carry text. We only read what we sent, but Claude may include other block
// types in future model versions — keep the shape loose with index signatures.
interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  [k: string]: unknown;
}

// Outbound blocks we send back. `tool_result` blocks need a `tool_use_id` and
// a stringified content payload. Defined as a separate type so we don't have
// to cast through unknown when constructing them.
type OutboundBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: Array<ClaudeContentBlock | OutboundBlock>;
}

export async function bonRunAiCommand(
  apiKey: string,
  input: string,
  dispatch: AiCommandDispatch,
  options: BonRunAiCommandOptions = {}
): Promise<AiCommandResult> {
  const { history = [], onProgress, signal } = options;
  const startedAt = performance.now();

  // The reports snapshot is no longer included inline. Claude calls the
  // `list_users` tool when it needs it — so off-topic or social input
  // never pays the ~55K-token snapshot cost.
  const messages: ClaudeMessage[] = [
    ...history,
    {
      role: "user",
      content: [{ type: "text", text: input }],
    },
  ];

  const actions: AiCommandAction[] = [];
  let totalCostUsd: number | null = null;
  let lastModel = BON_AI_COMMAND_MODEL;
  let finalText = "";

  for (let turn = 0; turn < BON_AI_COMMAND_MAX_TURNS; turn++) {
    if (signal?.aborted) {
      return {
        ok: false,
        summary: finalText || "Cancelled.",
        actions,
        costUsd: totalCostUsd,
        model: lastModel,
        history: messages,
        error: "aborted",
      };
    }

    onProgress?.({ kind: "turn-start", turn });

    const response = await streamClaude(
      apiKey,
      messages,
      turn,
      onProgress,
      signal
    );
    lastModel = response.model;
    onProgress?.({ kind: "model", model: response.model });

    if (response.costUsd !== null) {
      totalCostUsd = (totalCostUsd ?? 0) + response.costUsd;
      onProgress?.({ kind: "cost", costUsd: totalCostUsd });
    }

    const blocks = response.content;

    messages.push({ role: "assistant", content: blocks });

    const textBlocks = blocks.filter((block) => block.type === "text");
    const toolUseBlocks = blocks.filter((block) => block.type === "tool_use");

    if (textBlocks.length > 0) {
      finalText = textBlocks
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();
    }

    if (toolUseBlocks.length === 0 || response.stopReason !== "tool_use") {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(
        `[Bot or Not] timing: ai-command ${elapsedMs}ms (${actions.length} actions)`
      );

      return {
        ok: true,
        summary: finalText || "Done.",
        actions,
        costUsd: totalCostUsd,
        model: lastModel,
        history: messages,
      };
    }

    const toolResultBlocks: OutboundBlock[] = [];

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
    ok: false,
    summary: finalText || "Command exceeded the maximum number of turns.",
    actions,
    costUsd: totalCostUsd,
    model: lastModel,
    history: messages,
    error: "max-turns-exceeded",
  };
}

interface ClaudeCallReturn {
  content: ClaudeContentBlock[];
  stopReason: string;
  costUsd: number | null;
  model: string;
}

// In-flight block while we stream. Index = position in the model's content
// array. text accumulates from text_delta; inputJson accumulates from
// input_json_delta and is parsed once at the end.
interface StreamingBlock {
  type: string;
  text: string;
  id: string;
  name: string;
  inputJson: string;
}

async function streamClaude(
  apiKey: string,
  messages: ClaudeMessage[],
  turn: number,
  onProgress: AiCommandProgress | undefined,
  externalSignal: AbortSignal | undefined
): Promise<ClaudeCallReturn> {
  const body = {
    model: BON_AI_COMMAND_MODEL,
    max_tokens: 2048,
    stream: true,
    system: [
      {
        type: "text",
        text: BON_AI_COMMAND_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: BON_AI_COMMAND_TOOLS,
    messages,
  };

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);
  const timeoutId = setTimeout(
    () => controller.abort(),
    BON_AI_COMMAND_TIMEOUT_MS
  );

  const cleanup = (): void => {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  let response: Response;
  try {
    response = await fetch(BON_AI_COMMAND_API_URL, {
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
    cleanup();
    if ((error as { name?: string })?.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new Error("ai-command aborted by operator", { cause: error });
      }

      throw new Error(
        `Claude API timed out after ${BON_AI_COMMAND_TIMEOUT_MS / 1000}s`,
        { cause: error }
      );
    }

    throw error;
  }

  if (!response.ok) {
    cleanup();
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Claude API ${response.status}: ${errorText.slice(0, 300)}`
    );
  }

  const blocks = new Map<number, StreamingBlock>();
  let stopReason = "end_turn";
  let usage: ClaudeUsage | null = null;
  let model = BON_AI_COMMAND_MODEL;

  const reader = response.body?.getReader();
  if (!reader) {
    cleanup();
    throw new Error("Claude API returned empty body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // Parse the Anthropic SSE event stream. Each event is `event: <name>\n
    // data: <json>\n\n` (blank line terminates). We only care about `data:`
    // lines — the event-name line is informational and the JSON includes the
    // same `type` field.
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
          model = message?.model ?? model;
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
              onProgress?.({ kind: "assistant-text-delta", turn, text: chunk });
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

  // Materialize content blocks in index order. tool_use inputs are reassembled
  // from streamed JSON chunks here — partial_json is always a valid prefix of
  // the final input, so the parse only happens once we've seen content_block_stop.
  const sortedIndices = Array.from(blocks.keys()).sort((a, b) => a - b);
  const content: ClaudeContentBlock[] = sortedIndices.map((idx) => {
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

  const costUsd = bonEstimateCostUsd(usage, model);

  return { content, stopReason, costUsd, model };
}
