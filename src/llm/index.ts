// Public entry point for the LLM layer. Callers grab a provider via
// `createLlmProvider(apiKey, vendor?)` and talk to it through the
// `LlmProvider` interface — they never import a concrete provider class
// directly.
//
// Vendor selection is explicit when the caller passes it; when omitted, we
// fall back to sniffing the key prefix (`sk-ant-…` → Anthropic). The
// settings UI persists the user's choice and passes it through; one-off
// callers without a stored choice (CLI scripts, the dev-key bootstrap)
// get the sniffing fallback.

import { AnthropicProvider } from "./anthropic.ts";
import { OpenAIProvider } from "./openai.ts";
import type { LlmProvider, LlmVendor } from "./provider.ts";

export const LLM_VENDORS: ReadonlyArray<{
  id: LlmVendor;
  label: string;
  keyPlaceholder: string;
}> = [
  { id: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI", keyPlaceholder: "sk-..." },
];

export function createLlmProvider(
  apiKey: string,
  vendor?: LlmVendor | null
): LlmProvider {
  const resolved = vendor ?? sniffVendor(apiKey);

  switch (resolved) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "anthropic":
    default:
      return new AnthropicProvider(apiKey);
  }
}

// Fallback for callers that don't know the user's vendor preference. Keys
// that don't match a known prefix fall through to Anthropic — the original
// default.
export function sniffVendor(apiKey: string): LlmVendor {
  if (apiKey.startsWith("sk-ant-")) {
    return "anthropic";
  }

  if (apiKey.startsWith("sk-")) {
    return "openai";
  }

  return "anthropic";
}

export type {
  LlmAction,
  LlmContentPart,
  LlmMessage,
  LlmProgressEvent,
  LlmProvider,
  LlmTool,
  LlmToolDispatch,
  LlmVendor,
} from "./provider.ts";
