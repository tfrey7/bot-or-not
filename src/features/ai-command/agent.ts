// AI command shell. Frames the operator's natural-language input as a
// user message, then hands the conversation off to the LLM provider's
// tool loop. Provider-specific concerns — streaming SSE, content-block
// translation, multi-turn driving — live below the seam in `src/llm/`.
//
// The reports snapshot is no longer included inline; the model calls the
// `list_users` tool when it needs it, so off-topic input never pays the
// snapshot cost. See `handler.ts` for the dispatch side.

import { createLlmProvider } from "../../llm/index.ts";
import type {
  LlmAction,
  LlmMessage,
  LlmProgressEvent,
  LlmToolDispatch,
  LlmVendor,
} from "../../llm/index.ts";
import AI_COMMAND_PROMPT from "./prompt.md?raw";
import { AI_COMMAND_TOOLS } from "./tools.ts";

const AI_COMMAND_MAX_TURNS = 8;
const AI_COMMAND_MAX_TOKENS = 2048;
const AI_COMMAND_TIMEOUT_MS = 60_000;

// The conversation history shape is opaque to the rest of the
// extension. Callers store it between `runAiCommand` calls and hand
// it back next turn — the underlying provider owns the schema.
export type AiCommandMessage = LlmMessage;

// Progress events the modal subscribes to. Re-exported from the LLM
// layer; see `LlmProgressEvent` for the full vocabulary.
export type AiCommandProgressEvent = LlmProgressEvent;
export type AiCommandProgress = (event: AiCommandProgressEvent) => void;

export type AiCommandAction = LlmAction;
export type AiCommandDispatch = LlmToolDispatch;

export interface AiCommandResult {
  ok: boolean;
  summary: string;
  actions: AiCommandAction[];
  costUsd: number | null;
  model: string;
  history: AiCommandMessage[];
  error?: string;
}

export interface RunAiCommandOptions {
  history?: AiCommandMessage[];
  onProgress?: AiCommandProgress;
  signal?: AbortSignal;
  vendor?: LlmVendor | null;
  model?: string | null;
}

export async function runAiCommand(
  apiKey: string,
  input: string,
  dispatch: AiCommandDispatch,
  options: RunAiCommandOptions = {}
): Promise<AiCommandResult> {
  const { history = [], onProgress, signal, vendor, model } = options;

  const messages: LlmMessage[] = [
    ...history,
    { role: "user", content: [{ kind: "text", text: input }] },
  ];

  const provider = createLlmProvider(apiKey, vendor ?? null);

  const loop = await provider.runToolLoop({
    systemPrompt: AI_COMMAND_PROMPT,
    tools: AI_COMMAND_TOOLS,
    messages,
    dispatch,
    maxTokens: AI_COMMAND_MAX_TOKENS,
    maxTurns: AI_COMMAND_MAX_TURNS,
    timeoutMs: AI_COMMAND_TIMEOUT_MS,
    label: "ai-command",
    ...(onProgress ? { onProgress } : {}),
    ...(signal ? { signal } : {}),
    ...(model ? { model } : {}),
  });

  if (loop.aborted) {
    return {
      ok: false,
      summary: loop.finalText || "Cancelled.",
      actions: loop.actions,
      costUsd: loop.costUsd,
      model: loop.model,
      history: loop.history,
      error: "aborted",
    };
  }

  if (loop.maxTurnsExceeded) {
    return {
      ok: false,
      summary: loop.finalText,
      actions: loop.actions,
      costUsd: loop.costUsd,
      model: loop.model,
      history: loop.history,
      error: "max-turns-exceeded",
    };
  }

  return {
    ok: true,
    summary: loop.finalText,
    actions: loop.actions,
    costUsd: loop.costUsd,
    model: loop.model,
    history: loop.history,
  };
}
