// Tool-use loop against the Claude Messages API. Hands the operator's
// natural-language command to Claude along with a slim snapshot of the
// reports store; Claude picks tools and we dispatch them via the
// caller-provided `dispatch` callback (background.ts routes those to the
// same handler functions onMessage uses).

import type { ClaudeUsage } from "../../types.ts";
import { bonEstimateCostUsd } from "../../utils/cost.ts";
import BON_AI_COMMAND_PROMPT from "./prompt.md?raw";
import type { AiCommandSnapshotEntry } from "./snapshot.ts";
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

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: ClaudeUsage;
  model?: string;
}

export async function bonRunAiCommand(
  apiKey: string,
  snapshot: AiCommandSnapshotEntry[],
  input: string,
  dispatch: AiCommandDispatch,
  history: AiCommandMessage[] = []
): Promise<AiCommandResult> {
  const startedAt = performance.now();

  // The snapshot rides along with the first message of a conversation; on
  // follow-ups we trust Claude to remember it from prior context (and accept
  // some drift if the operator mutated data mid-conversation — a fresh
  // snapshot every turn would balloon tokens). The system prompt is cached,
  // so the on-the-wire bytes stay manageable as the history grows.
  const userText =
    history.length === 0
      ? `Operator command: ${input}\n\nCurrent reports snapshot (JSON):\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``
      : `Operator follow-up: ${input}`;

  const messages: ClaudeMessage[] = [
    ...history,
    {
      role: "user",
      content: [{ type: "text", text: userText }],
    },
  ];

  const actions: AiCommandAction[] = [];
  let totalCostUsd: number | null = null;
  let lastModel = BON_AI_COMMAND_MODEL;
  let finalText = "";

  for (let turn = 0; turn < BON_AI_COMMAND_MAX_TURNS; turn++) {
    const response = await callClaude(apiKey, messages);
    lastModel = response.model;

    if (response.costUsd !== null) {
      totalCostUsd = (totalCostUsd ?? 0) + response.costUsd;
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

async function callClaude(
  apiKey: string,
  messages: ClaudeMessage[]
): Promise<ClaudeCallReturn> {
  const body = {
    model: BON_AI_COMMAND_MODEL,
    max_tokens: 2048,
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
  const timeoutId = setTimeout(
    () => controller.abort(),
    BON_AI_COMMAND_TIMEOUT_MS
  );

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
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error(
        `Claude API timed out after ${BON_AI_COMMAND_TIMEOUT_MS / 1000}s`,
        { cause: error }
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Claude API ${response.status}: ${errorText.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as ClaudeResponse;
  const model = payload.model ?? BON_AI_COMMAND_MODEL;
  const costUsd = bonEstimateCostUsd(payload.usage ?? null, model);

  return {
    content: payload.content ?? [],
    stopReason: payload.stop_reason ?? "end_turn",
    costUsd,
    model,
  };
}
