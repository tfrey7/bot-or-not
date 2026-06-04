// Provider-agnostic LLM interface. The two features that call out to a
// language model — investigation (`features/investigation/`) and the AI
// command bar (`features/ai-command/`) — talk to a provider through this
// interface, not to Anthropic directly. Anthropic is one implementation;
// future OpenAI / Gemini impls live alongside it under `src/llm/`.
//
// Design rules:
//   - Nothing in this file knows about Anthropic. Content parts, tool
//     specs, progress events, and message roles use a normalized vocabulary
//     that any provider can translate to its own wire format.
//   - `ClaudeUsage` is the on-disk usage shape (stored on every
//     Investigation record). It stays under that name for now — when a
//     second provider lands we either translate its usage into this shape
//     or migrate the storage schema. Keeping the name is a deliberate
//     "second pass" decision, not laziness.

import type { ClaudeUsage } from "../types.ts";
import { parseRetryAfter } from "../utils/retry_after.ts";

// Stamps httpStatus + retryAfterMs (parsed from the Retry-After header)
// onto an Error so the queue can pause requeued runs after a 429 instead
// of immediately hammering the upstream again.
export function enrichLlmError(error: Error, response: Response): Error {
  const enriched = error as Error & {
    httpStatus?: number;
    retryAfterMs?: number | null;
  };
  enriched.httpStatus = response.status;
  enriched.retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));

  return error;
}

type LlmRole = "user" | "assistant";

// Pieces of a single message. `tool-use` and `tool-result` parts only
// appear inside `runToolLoop` conversations — `complete` callers stick to
// `text` and `image`.
export type LlmContentPart =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string }
  | {
      kind: "tool-use";
      id: string;
      tool: string;
      input: Record<string, unknown>;
    }
  | { kind: "tool-result"; toolUseId: string; content: string };

export interface LlmMessage {
  role: LlmRole;
  content: LlmContentPart[];
}

// JSON Schema for a tool's input. Matches the subset every major provider
// accepts (Anthropic `input_schema`, OpenAI function `parameters`, Gemini
// `parameters`). Tools are passed in normalized form; the provider
// translates the field name (`input_schema` vs `parameters`) on the wire.
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Streaming + dispatch events emitted as `runToolLoop` works. UIs render
// these to show a live action log + token-streamed reply. The kinds are
// abstract enough that any provider can map its native stream onto them:
//
//  - turn-start          : about to call the model
//  - model               : echoed model id from the response
//  - assistant-text-delta: incremental text chunk for the prose pane
//  - tool-use-start      : a tool call opened (we have name+id but the
//                          input is still being streamed)
//  - tool-use-input      : full tool input parsed; about to dispatch
//  - tool-use-end        : dispatch returned (result on success, error on fail)
//  - cost                : running total cost in USD after this turn's usage
export type LlmProgressEvent =
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

export type LlmProgressListener = (event: LlmProgressEvent) => void;

// One tool invocation as it appeared inside a `runToolLoop` call. The
// shell collects these across all turns and hands them back so the UI can
// summarize "X actions taken."
export interface LlmAction {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// Caller-provided tool runner. Returns whatever JSON it likes; the `ok`
// flag is what the loop uses to decide whether to feed an error or a
// success body back to the model.
export type LlmToolDispatch = (
  tool: string,
  input: Record<string, unknown>
) => Promise<{ ok: boolean; error?: string; [k: string]: unknown }>;

export interface LlmCompleteRequest {
  systemPrompt: string;
  userContent: LlmContentPart[];
  maxTokens: number;
  model?: string;
  label?: string;
  timeoutMs?: number;
}

export interface LlmCompleteResult {
  text: string;
  usage: ClaudeUsage | null;
  model: string;
  costUsd: number | null;
}

export interface LlmToolLoopRequest {
  systemPrompt: string;
  tools: LlmTool[];

  // Full prior history plus the new user turn. The caller owns the
  // append; the provider only reads.
  messages: LlmMessage[];
  dispatch: LlmToolDispatch;
  maxTokens: number;
  maxTurns: number;
  onProgress?: LlmProgressListener;
  signal?: AbortSignal;
  model?: string;
  label?: string;
  timeoutMs?: number;
}

// `history` carries the full message log after this turn — assistant
// tool_use blocks, tool_result blocks, and the final reply. The caller
// stores it opaquely and hands it back next call.
export interface LlmToolLoopResult {
  history: LlmMessage[];
  actions: LlmAction[];
  finalText: string;
  stopReason: string;
  usage: ClaudeUsage | null;
  model: string;
  costUsd: number | null;
  aborted: boolean;
  maxTurnsExceeded: boolean;
}

// Curated model entry for the settings dropdown. The id is what gets sent
// to the provider's API; the label is what the user sees. Vendors expose
// list-models endpoints, but those include deprecated / embedding / non-tool
// variants and never include pricing — so the dropdown is fed from this
// hand-picked list, not from a runtime call. Add a new model = add a row
// here + a row in `cost.ts` and it appears in the UI.
export interface LlmModelOption {
  id: string;
  label: string;
}

// Stable id for the backend, used as the storage value of the vendor
// dropdown and as the explicit hint passed into `createLlmProvider`.
export type LlmVendor = "anthropic" | "openai";

export interface LlmProvider {
  readonly vendor: LlmVendor;
  readonly defaultModel: string;
  readonly availableModels: readonly LlmModelOption[];
  complete(request: LlmCompleteRequest): Promise<LlmCompleteResult>;
  runToolLoop(request: LlmToolLoopRequest): Promise<LlmToolLoopResult>;
}
