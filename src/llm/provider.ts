// Provider-agnostic LLM interface. Features that call out to a language
// model — investigation (`features/investigation/`) — talk to a provider
// through this interface, not to Anthropic directly. Anthropic is one
// implementation; future OpenAI / Gemini impls live alongside it under
// `src/llm/`.
//
// Design rules:
//   - Nothing in this file knows about Anthropic. Content parts use a
//     normalized vocabulary that any provider can translate to its own
//     wire format.
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

export type LlmContentPart =
  { kind: "text"; text: string } | { kind: "image"; url: string };

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
}
