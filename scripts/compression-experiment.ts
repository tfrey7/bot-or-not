// 2x2 experiment: Haiku vs Sonnet × uncompressed vs compressed payload.
// Goal: prove the conservative trims don't change the verdict while
// halving the input cost.
//
// Compression (the "compressed" variant):
//   1. Drop url, permalink, is_self, over_18 from posts.
//   2. Drop permalink from comments.
//   3. Drop removed_by_category whenever null on both posts and comments.
//   4. ISO timestamps → epoch seconds (string of digits).
//   5. Compact JSON (no pretty-print) when serializing the user content.
//
// Each user × model × compression cell is one Claude call against the
// SAME pre-built ProfileSummary (no re-fetch), so any verdict difference
// is attributable to the swap and not to Reddit-side variance.
//
// Usage:
//   npm exec tsx scripts/compression-experiment.ts -- <user1> <user2> ...

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { DOMParser as LinkedomDOMParser } from "linkedom";

(globalThis as unknown as { DOMParser: typeof LinkedomDOMParser }).DOMParser =
  LinkedomDOMParser;

import {
  bonFetchBotBouncerStatus,
  bonFetchRedditProfile,
  RedditFetchError,
} from "../src/features/investigation/fetch.ts";
import {
  bonExtractSnoovatarUrl,
  bonSummarizeProfile,
} from "../src/features/investigation/summarize.ts";
import { bonWebSearchRedditUser } from "../src/features/web-search/index.ts";
import { bonExtractJson } from "../src/utils/json.ts";
import { bonNormalizePersona } from "../src/utils/persona.ts";
import { bonEstimateCostUsd } from "../src/utils/cost.ts";
import { bonComputeVerdict } from "../src/verdict.ts";
import type {
  ClaudeUsage,
  Factor,
  ProfileSummary,
} from "../src/types.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = resolve(REPO_ROOT, "src/features/investigation/prompt.md");
const PROMPT = readFileSync(PROMPT_PATH, "utf8");

const MAX_ITEMS_PER_KIND = 200;
const MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6"];
const COMPRESSION_MODES: Array<"uncompressed" | "compressed"> = [
  "uncompressed",
  "compressed",
];

const usernames = process.argv.slice(2);
if (usernames.length === 0) {
  console.error(
    "Usage: tsx scripts/compression-experiment.ts <user1> <user2> ..."
  );
  process.exit(1);
}

const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing CLAUDE_API_KEY.");
  process.exit(1);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes("reddit.com")) {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", "bot-or-not-cli/1.0 (compression-experiment)");
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
}) as typeof fetch;

// Inline Anthropic call so we control JSON pretty-printing and model id
// directly without modifying the production api.ts.
interface ClaudeContentBlock {
  type: string;
  text?: string;
}
interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
}

async function callClaude(opts: {
  model: string;
  userContentText: string;
  avatarUrl: string | null;
}): Promise<{
  rawText: string;
  usage: ClaudeUsage | null;
  model: string;
  costUsd: number | null;
  latencyMs: number;
}> {
  const start = performance.now();
  const userContent: Array<Record<string, unknown>> = [];
  if (opts.avatarUrl) {
    userContent.push({
      type: "image",
      source: { type: "url", url: opts.avatarUrl },
    });
  }
  userContent.push({ type: "text", text: opts.userContentText });

  const body = {
    model: opts.model,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Claude API ${response.status}: ${errText.slice(0, 300)}`);
  }
  const payload = (await response.json()) as ClaudeResponse;
  const text = (payload.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
  const model = payload.model ?? opts.model;
  const costUsd = bonEstimateCostUsd(payload.usage, model);
  return {
    rawText: text,
    usage: payload.usage ?? null,
    model,
    costUsd,
    latencyMs,
  };
}

// Compress a ProfileSummary in-place style: returns a new object with
// safe-to-drop fields removed and timestamps as epoch seconds.
function compressSummary(summary: ProfileSummary): ProfileSummary {
  const isoToEpoch = (iso: string | null): string | null => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return iso;
    return String(Math.floor(t / 1000));
  };

  const compressedPosts = summary.recent_posts.map((p) => {
    const out: Record<string, unknown> = {
      subreddit: p.subreddit,
      title: p.title,
      selftext_excerpt: p.selftext_excerpt,
      score: p.score,
      num_comments: p.num_comments,
      created_at: isoToEpoch(p.created_at),
    };
    if (p.removed_by_category !== null) {
      out.removed_by_category = p.removed_by_category;
    }
    return out;
  });
  const compressedComments = summary.recent_comments.map((c) => {
    const out: Record<string, unknown> = {
      subreddit: c.subreddit,
      body_excerpt: c.body_excerpt,
      score: c.score,
      created_at: isoToEpoch(c.created_at),
      link_title: c.link_title,
    };
    if (c.removed_by_category !== null) {
      out.removed_by_category = c.removed_by_category;
    }
    return out;
  });

  return {
    ...summary,
    recent_posts: compressedPosts as ProfileSummary["recent_posts"],
    recent_comments: compressedComments as ProfileSummary["recent_comments"],
  };
}

function buildUserContentText(
  summary: ProfileSummary,
  compressed: boolean
): string {
  const json = compressed
    ? JSON.stringify(summary)
    : JSON.stringify(summary, null, 2);
  return (
    "Analyze the following Reddit account and return ONLY the JSON verdict object as specified in your instructions.\n\n```json\n" +
    json +
    "\n```"
  );
}

interface CellResult {
  model: string;
  compression: "uncompressed" | "compressed";
  verdict: string;
  botProbability: number;
  confidence: number;
  personaLabel: string | null;
  topArchetypes: Array<[string, number]>;
  summary: string;
  factorScores: Record<string, number>;
  costUsd: number | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  userContentBytes: number;
}

interface UserExperiment {
  username: string;
  postsFetched: number;
  commentsFetched: number;
  botBouncerStatus: string | null;
  uncompressedBytes: number;
  compressedBytes: number;
  cells: CellResult[];
}

async function runUser(username: string): Promise<UserExperiment> {
  console.error(`[${username}] fetching reddit...`);
  const [profileSettled, botBouncerSettled, webSearchSettled] =
    await Promise.allSettled([
      bonFetchRedditProfile(username),
      bonFetchBotBouncerStatus(username),
      bonWebSearchRedditUser(username),
    ]);

  if (profileSettled.status === "rejected") {
    const r = profileSettled.reason;
    throw new Error(
      `Reddit fetch failed for ${username}: ${r instanceof RedditFetchError ? r.message : String(r)}`
    );
  }

  const { profile } = profileSettled.value;
  const botBouncerStatus =
    botBouncerSettled.status === "fulfilled"
      ? botBouncerSettled.value.status
      : null;
  const webSearchResults =
    webSearchSettled.status === "fulfilled"
      ? (webSearchSettled.value?.results ?? [])
      : [];
  const postsFetched = profile.submitted.data?.children?.length ?? 0;
  const commentsFetched = profile.comments.data?.children?.length ?? 0;
  console.error(
    `[${username}] posts=${postsFetched} comments=${commentsFetched} bb=${botBouncerStatus ?? "-"} ddg=${webSearchResults.length}`
  );

  const fullSummary = bonSummarizeProfile(username, profile, {
    ...(botBouncerStatus
      ? { botBouncerStatus, botBouncerCheckedAt: Date.now() }
      : {}),
    webSearchResults,
  });
  // Cap items so uncompressed baseline doesn't 400 on heavy users.
  fullSummary.recent_posts = fullSummary.recent_posts.slice(
    0,
    MAX_ITEMS_PER_KIND
  );
  fullSummary.recent_comments = fullSummary.recent_comments.slice(
    0,
    MAX_ITEMS_PER_KIND
  );
  const avatarUrl = bonExtractSnoovatarUrl(profile);

  const uncompressedText = buildUserContentText(fullSummary, false);
  const compressedSummary = compressSummary(fullSummary);
  const compressedText = buildUserContentText(compressedSummary, true);

  console.error(
    `[${username}] payload sizes: uncompressed=${uncompressedText.length.toLocaleString()}B  compressed=${compressedText.length.toLocaleString()}B  (-${Math.round((1 - compressedText.length / uncompressedText.length) * 100)}%)`
  );

  const cells: CellResult[] = [];
  for (const compression of COMPRESSION_MODES) {
    for (const model of MODELS) {
      const text =
        compression === "compressed" ? compressedText : uncompressedText;
      console.error(`[${username}] ${model} ${compression}...`);
      try {
        const result = await callClaude({
          model,
          userContentText: text,
          avatarUrl,
        });
        const extracted = bonExtractJson(result.rawText);
        if (!extracted || typeof extracted !== "object") {
          console.error(`  failed to parse JSON: ${result.rawText.slice(0, 200)}`);
          continue;
        }
        const payload = extracted as Record<string, unknown>;
        if (!Array.isArray(payload.factors)) {
          console.error(`  missing factors`);
          continue;
        }
        const factors = payload.factors as Factor[];
        const persona = bonNormalizePersona(payload.persona);
        const verdict = bonComputeVerdict(factors);
        const factorScores: Record<string, number> = {};
        for (const f of factors) {
          if (typeof f.score === "number") factorScores[f.key] = f.score;
        }
        const archetypes = persona?.archetypes ?? {};
        const topArchetypes = Object.entries(archetypes)
          .filter(([, v]) => typeof v === "number")
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 3) as Array<[string, number]>;
        cells.push({
          model: result.model,
          compression,
          verdict: verdict.verdict,
          botProbability: verdict.botProbability,
          confidence: verdict.confidence,
          personaLabel: persona?.label ?? null,
          topArchetypes,
          summary:
            typeof payload.summary === "string" ? payload.summary : "",
          factorScores,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          inputTokens: result.usage?.input_tokens ?? 0,
          outputTokens: result.usage?.output_tokens ?? 0,
          cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
          cacheCreateTokens: result.usage?.cache_creation_input_tokens ?? 0,
          userContentBytes: text.length,
        });
      } catch (err) {
        console.error(
          `  call failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return {
    username,
    postsFetched,
    commentsFetched,
    botBouncerStatus,
    uncompressedBytes: uncompressedText.length,
    compressedBytes: compressedText.length,
    cells,
  };
}

function factorDelta(
  a: Record<string, number>,
  b: Record<string, number>
): { maxDelta: number; meanDelta: number; flipped: string[] } {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let max = 0;
  let sum = 0;
  let n = 0;
  const flipped: string[] = [];
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    const d = Math.abs(av - bv);
    if (d > max) max = d;
    sum += d;
    n++;
    if (Math.sign(av) !== Math.sign(bv) && Math.abs(av) > 0.2 && Math.abs(bv) > 0.2) {
      flipped.push(k);
    }
  }
  return { maxDelta: max, meanDelta: n ? sum / n : 0, flipped };
}

function printReport(results: UserExperiment[]): void {
  console.log("");
  console.log("=== Per-user 2x2 grid ===");
  for (const r of results) {
    console.log("");
    console.log(
      `u/${r.username}  (posts=${r.postsFetched}, comments=${r.commentsFetched}, bb=${r.botBouncerStatus ?? "-"})`
    );
    console.log(
      `  payload: uncompressed=${r.uncompressedBytes.toLocaleString()}B, compressed=${r.compressedBytes.toLocaleString()}B  (-${Math.round((1 - r.compressedBytes / r.uncompressedBytes) * 100)}%)`
    );
    console.log(
      "  " +
        "model".padEnd(22) +
        "compression".padEnd(14) +
        "verdict".padEnd(14) +
        "botP".padEnd(7) +
        "persona".padEnd(10) +
        "in/out".padEnd(13) +
        "lat".padEnd(7) +
        "cost"
    );
    for (const c of r.cells) {
      console.log(
        "  " +
          c.model.padEnd(22) +
          c.compression.padEnd(14) +
          c.verdict.padEnd(14) +
          c.botProbability.toFixed(2).padEnd(7) +
          (c.personaLabel ?? "-").padEnd(10) +
          `${c.inputTokens}/${c.outputTokens}`.padEnd(13) +
          `${c.latencyMs}ms`.padEnd(7) +
          (c.costUsd !== null ? `$${c.costUsd.toFixed(4)}` : "?")
      );
    }

    // Compression-induced delta (same model, uncompressed vs compressed)
    console.log("  compression deltas (same model, unc → cmp):");
    for (const model of MODELS) {
      const unc = r.cells.find(
        (c) =>
          c.compression === "uncompressed" && c.model.startsWith(model)
      );
      const cmp = r.cells.find(
        (c) =>
          c.compression === "compressed" && c.model.startsWith(model)
      );
      if (!unc || !cmp) continue;
      const d = factorDelta(unc.factorScores, cmp.factorScores);
      const verdictMatch = unc.verdict === cmp.verdict ? "✓" : "✗";
      const personaMatch =
        unc.personaLabel === cmp.personaLabel ? "✓" : "✗";
      const botPDelta = Math.abs(
        unc.botProbability - cmp.botProbability
      ).toFixed(2);
      console.log(
        `    ${model.padEnd(22)} verdict=${verdictMatch} (${unc.verdict}→${cmp.verdict})  persona=${personaMatch} (${unc.personaLabel}→${cmp.personaLabel})  botP|Δ|=${botPDelta}  factors meanΔ=${d.meanDelta.toFixed(2)} maxΔ=${d.maxDelta.toFixed(2)}${d.flipped.length ? ` flipped=[${d.flipped.join(", ")}]` : ""}`
      );
    }
  }

  console.log("");
  console.log("=== Cost totals ===");
  const cells: Record<
    string,
    { cost: number; lat: number; bytes: number; n: number }
  > = {};
  for (const r of results) {
    for (const c of r.cells) {
      const key = `${c.model.replace(/-\d{8}$/, "")} ${c.compression}`;
      if (!cells[key])
        cells[key] = { cost: 0, lat: 0, bytes: 0, n: 0 };
      if (c.costUsd !== null) cells[key].cost += c.costUsd;
      cells[key].lat += c.latencyMs;
      cells[key].bytes += c.userContentBytes;
      cells[key].n += 1;
    }
  }
  for (const [key, t] of Object.entries(cells)) {
    console.log(
      `  ${key.padEnd(38)} total $${t.cost.toFixed(4)}  avg $${(t.cost / t.n).toFixed(4)}/call  avg ${Math.round(t.lat / t.n)}ms  avg ${Math.round(t.bytes / t.n).toLocaleString()}B`
    );
  }
}

async function main(): Promise<void> {
  const results: UserExperiment[] = [];
  for (const u of usernames) {
    try {
      results.push(await runUser(u));
    } catch (err) {
      console.error(`[${u}] failed:`, err instanceof Error ? err.message : err);
    }
  }
  printReport(results);

  const outPath = "/tmp/compression-experiment.json";
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.error(`\nFull dump: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
