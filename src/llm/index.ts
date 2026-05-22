// Public entry point for the LLM layer. Callers grab a provider via
// `bonCreateLlmProvider(apiKey)` and talk to it through the `LlmProvider`
// interface — they never import a concrete provider class directly.
//
// Today the factory always returns `AnthropicProvider`. When a second
// provider lands, this is where key-prefix sniffing (`sk-ant-…` vs
// `sk-…` vs `AIza…`) chooses the implementation.

import { AnthropicProvider } from "./anthropic.ts";
import type { LlmProvider } from "./provider.ts";

export function bonCreateLlmProvider(apiKey: string): LlmProvider {
  return new AnthropicProvider(apiKey);
}

export type {
  LlmAction,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmContentPart,
  LlmMessage,
  LlmProgressEvent,
  LlmProgressListener,
  LlmProvider,
  LlmRole,
  LlmTool,
  LlmToolDispatch,
  LlmToolLoopRequest,
  LlmToolLoopResult,
} from "./provider.ts";
