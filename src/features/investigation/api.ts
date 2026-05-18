// Thin wrapper over the Anthropic Messages API. Marks the system prompt
// for ephemeral (5-min) caching since it's byte-identical across runs;
// back-to-back investigations within ~5 min hit the cache at ~10% of the
// input rate. Optional server-side web_search lets the model fact-check
// suspicious accounts against external context — capped at 1 use so the
// cost stays predictable.

import type { ClaudeUsage, ProfileSummary } from "../../types.ts";
import { bonEstimateCostUsd } from "../../utils/cost.ts";

const BON_CLAUDE_MODEL = "claude-sonnet-4-6";
const BON_CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// Hard ceiling on the Claude call. Sonnet 4.6 on a 14k-token prompt
// typically returns in 40-90s; anything past this is a hung connection,
// not a slow one.
const BON_CLAUDE_TIMEOUT_MS = 4 * 60 * 1000;

export interface ClaudeCallResult {
  rawText: string;
  usage: ClaudeUsage | null;
  model: string;
  webSearchCount: number;
  costUsd: number | null;
}

export interface ClaudeCallOptions {
  webSearch?: boolean;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
}

export async function bonCallClaude(
  apiKey: string,
  systemPrompt: string,
  profileSummary: ProfileSummary,
  label = "claude",
  options: ClaudeCallOptions = {}
): Promise<ClaudeCallResult> {
  const t0 = performance.now();
  const webSearchOn = !!options.webSearch;
  const body: Record<string, unknown> = {
    model: BON_CLAUDE_MODEL,
    // Bumped from 4096 — with web_search the response can include
    // intermediate text blocks (Claude narrating before/after the search)
    // on top of the final JSON verdict. Sonnet 4.6 supports much higher;
    // 8192 is safe headroom without becoming a runaway expense.
    max_tokens: webSearchOn ? 8192 : 4096,
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
        content: [
          {
            type: "text",
            text:
              "Analyze the following Reddit account and return ONLY the JSON verdict object as specified in your instructions.\n\n```json\n" +
              JSON.stringify(profileSummary, null, 2) +
              "\n```",
          },
        ],
      },
    ],
  };
  if (webSearchOn) {
    body.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 1,
      },
    ];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BON_CLAUDE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(BON_CLAUDE_API_URL, {
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
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    console.log(`[Bot or Not] timing: ${label} ${ms}ms (failed)`);
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(
        `Claude API timed out after ${BON_CLAUDE_TIMEOUT_MS / 1000}s`,
        { cause: err }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const ms = Math.round(performance.now() - t0);
    console.log(`[Bot or Not] timing: ${label} ${ms}ms (${res.status})`);
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as ClaudeResponse;
  const text = (json.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n");

  // Count actual web_search invocations so the UI can show whether a
  // search happened (the model may decline to search if it judges the
  // data sufficient).
  const webSearchCount = (json.content || []).filter(
    (c) =>
      (c.type === "server_tool_use" || c.type === "tool_use") &&
      c.name === "web_search"
  ).length;

  const ms = Math.round(performance.now() - t0);
  const inTok = json.usage?.input_tokens ?? "?";
  const outTok = json.usage?.output_tokens ?? "?";
  const model = json.model || BON_CLAUDE_MODEL;
  const costUsd = bonEstimateCostUsd(json.usage, model, webSearchCount);
  const costStr = costUsd != null ? ` $${costUsd.toFixed(4)}` : "";
  console.log(
    `[Bot or Not] timing: ${label} ${ms}ms (in=${inTok} out=${outTok}${webSearchCount ? ` web=${webSearchCount}` : ""})${costStr}`
  );

  return {
    rawText: text,
    usage: json.usage || null,
    model,
    webSearchCount,
    costUsd,
  };
}
