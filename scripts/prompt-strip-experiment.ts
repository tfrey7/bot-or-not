// Cost A/B/C experiment for the prompt-stripping + deterministic-factors
// proposal. Three variants per user against Sonnet:
//
//   A. baseline      — full prompt.md, all 16 factors from the LLM
//   B. stripped      — `assemblePrompt` strips input-conditional sections
//                      (google_harvest/passive_harvest/hidden/avatar)
//                      that don't apply to this profile. LLM still scores
//                      all 16 factors.
//   C. stripped+det  — also strips the six deterministic-factor sections
//                      and asks the LLM for only the ten soft factors. The
//                      missing factors are filled in by
//                      `scoreDeterministicFactors`.
//
// Sequential per (user, variant) so the prompt cache state is
// predictable: the FIRST user of each variant pays the cache write; the
// rest of that variant's users hit cache-read pricing. This is the same
// pattern production sees during a burst of investigations.
//
// Usage:
//   npm exec tsx scripts/prompt-strip-experiment.ts -- <user1> <user2> ...
//   # default users = the reference-account memory set
//
// Reads CLAUDE_API_KEY from env.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { DOMParser as LinkedomDOMParser } from "linkedom";

(globalThis as unknown as { DOMParser: typeof LinkedomDOMParser }).DOMParser =
  LinkedomDOMParser;

import {
  fetchBotBouncerStatus,
  fetchRedditProfile,
  RedditFetchError,
} from "../src/features/investigation/fetch.ts";
import {
  extractSnoovatarUrl,
  summarizeProfile,
} from "../src/features/investigation/summarize.ts";
import { investigationCallLlm } from "../src/features/investigation/api.ts";
import { assemblePrompt } from "../src/features/investigation/assemble_prompt.ts";
import {
  DETERMINISTIC_FACTOR_KEYS,
  scoreDeterministicFactors,
} from "../src/features/investigation/deterministic_factors.ts";
import { mergeFactors } from "../src/features/investigation/merge_factors.ts";
import { FACTORS } from "../src/factors.ts";
import { extractJson } from "../src/utils/json.ts";
import { normalizePersona } from "../src/utils/persona.ts";
import { computeVerdict } from "../src/verdict.ts";
import type { Factor, ProfileSummary } from "../src/types.ts";

const DEFAULT_USERS = [
  "B-z_B-s",
  "Ask4MD",
  "WillyNilly1997",
  "candy-fairyx",
  "netphilia",
  "Biscocino",
  "siruppaws",
];

const MODEL = "claude-sonnet-4-6";

const usernames =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_USERS;

const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing CLAUDE_API_KEY in env");
  process.exit(1);
}

// Reddit UA shim — same as the other experiment scripts.
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
      headers.set("User-Agent", "bot-or-not-cli/1.0 (prompt-strip-experiment)");
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_RAW = readFileSync(
  resolve(REPO_ROOT, "src/features/investigation/prompt.md"),
  "utf8"
);
const ALL_FACTOR_KEYS = FACTORS.map((f) => f.key);
const SOFT_FACTOR_KEYS = ALL_FACTOR_KEYS.filter(
  (k) => !(DETERMINISTIC_FACTOR_KEYS as readonly string[]).includes(k)
);

interface RunResult {
  variant: "A" | "B" | "C" | "D";
  variantLabel: string;
  username: string;
  model: string;
  promptChars: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  verdict: string;
  botProb: number;
  persona: string | null;
  region: string | null;
  factors: Factor[];
  durationMs: number;
  error: string | null;
}

interface GatheredProfile {
  summary: ProfileSummary;
  avatarUrl: string | null;
}

async function gatherProfile(username: string): Promise<GatheredProfile> {
  const [profileRes, bbRes] = await Promise.allSettled([
    fetchRedditProfile(username),
    fetchBotBouncerStatus(username),
  ]);
  if (profileRes.status === "rejected") {
    const reason = profileRes.reason;
    if (reason instanceof RedditFetchError) {
      throw new Error(`Reddit fetch for u/${username} failed: ${reason.message}`);
    }
    throw reason;
  }
  const { profile } = profileRes.value;
  const bbStatus = bbRes.status === "fulfilled" ? bbRes.value.status : null;

  const extra: Record<string, unknown> = {};
  if (bbStatus) {
    extra.botBouncerStatus = bbStatus;
    extra.botBouncerCheckedAt = Date.now();
  }
  const summary = summarizeProfile(username, profile, extra);
  const avatarUrl = extractSnoovatarUrl(profile);
  return { summary, avatarUrl };
}

async function runVariant(
  variant: "A" | "B" | "C" | "D",
  label: string,
  prompt: string,
  llmFactorKeys: readonly string[],
  username: string,
  summary: ProfileSummary,
  avatarUrl: string | null
): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const claude = await investigationCallLlm(
      apiKey!,
      prompt,
      summary,
      `${variant}:${username}`,
      { avatarUrl, model: MODEL }
    );

    const durationMs = Date.now() - t0;
    const extracted = extractJson(claude.rawText) as Record<
      string,
      unknown
    > | null;
    const llmFactors = Array.isArray(extracted?.factors)
      ? (extracted!.factors as Factor[])
      : [];

    // Variant C: LLM gave us only the soft factors. Fill the rest with
    // deterministic scoring + merge into canonical order.
    let finalFactors: Factor[];
    if (variant === "C" || variant === "D") {
      const detFactors = scoreDeterministicFactors(summary);
      finalFactors = mergeFactors(llmFactors, detFactors);
    } else {
      finalFactors = mergeFactors(llmFactors, []);
    }

    const persona = normalizePersona(extracted?.persona ?? null);
    const verdict = computeVerdict(finalFactors);
    const regionRaw = (extracted?.region ?? null) as { code?: string } | null;

    const usage = claude.usage ?? ({} as Record<string, number>);
    return {
      variant,
      variantLabel: label,
      username,
      model: claude.model,
      promptChars: prompt.length,
      inputTokens: (usage as Record<string, number>).input_tokens ?? 0,
      outputTokens: (usage as Record<string, number>).output_tokens ?? 0,
      cacheReadTokens:
        (usage as Record<string, number>).cache_read_input_tokens ?? 0,
      cacheWriteTokens:
        (usage as Record<string, number>).cache_creation_input_tokens ?? 0,
      cost: claude.costUsd ?? 0,
      verdict: verdict.verdict,
      botProb: verdict.botProbability,
      persona: persona ? persona.label : null,
      region: regionRaw?.code ?? null,
      factors: finalFactors,
      durationMs,
      error: null,
    };
  } catch (err) {
    return {
      variant,
      variantLabel: label,
      username,
      model: MODEL,
      promptChars: prompt.length,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      verdict: "error",
      botProb: 0,
      persona: null,
      region: null,
      factors: [],
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function lpad(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function printPerVariantTable(results: RunResult[]): void {
  console.log("");
  console.log("=== Per-user per-variant results ===");
  console.log("");
  const header = [
    pad("user", 16),
    pad("variant", 12),
    lpad("prompt", 7),
    lpad("in", 7),
    lpad("cache-rd", 9),
    lpad("cache-wr", 9),
    lpad("out", 5),
    lpad("cost", 8),
    pad("verdict", 14),
    lpad("botProb", 8),
    pad("persona", 10),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log(
      [
        pad(r.username.slice(0, 16), 16),
        pad(r.variantLabel, 12),
        lpad(r.promptChars.toLocaleString(), 7),
        lpad(r.inputTokens.toLocaleString(), 7),
        lpad(r.cacheReadTokens.toLocaleString(), 9),
        lpad(r.cacheWriteTokens.toLocaleString(), 9),
        lpad(r.outputTokens.toLocaleString(), 5),
        lpad(`$${r.cost.toFixed(4)}`, 8),
        pad(r.error ? "ERROR" : r.verdict, 14),
        lpad(r.botProb.toFixed(3), 8),
        pad(r.persona ?? "—", 10),
      ].join(" ")
    );
  }
}

function printAggregateTable(results: RunResult[]): void {
  console.log("");
  console.log("=== Aggregate (mean per call) ===");
  console.log("");
  const byVariant = new Map<string, RunResult[]>();
  for (const r of results) {
    if (r.error) continue;
    const list = byVariant.get(r.variantLabel) ?? [];
    list.push(r);
    byVariant.set(r.variantLabel, list);
  }

  const header = [
    pad("variant", 16),
    lpad("n", 3),
    lpad("avg prompt", 11),
    lpad("avg in", 8),
    lpad("avg cache-rd", 13),
    lpad("avg cache-wr", 13),
    lpad("avg out", 8),
    lpad("avg cost", 10),
    lpad("sum cost", 10),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  const variantOrder = ["baseline", "stripped", "strip+det", "det-only"];
  for (const label of variantOrder) {
    const list = byVariant.get(label);
    if (!list || list.length === 0) continue;
    const n = list.length;
    const mean = (fn: (r: RunResult) => number): number =>
      list.reduce((s, r) => s + fn(r), 0) / n;
    const sum = (fn: (r: RunResult) => number): number =>
      list.reduce((s, r) => s + fn(r), 0);
    console.log(
      [
        pad(label, 16),
        lpad(String(n), 3),
        lpad(mean((r) => r.promptChars).toFixed(0), 11),
        lpad(mean((r) => r.inputTokens).toFixed(0), 8),
        lpad(mean((r) => r.cacheReadTokens).toFixed(0), 13),
        lpad(mean((r) => r.cacheWriteTokens).toFixed(0), 13),
        lpad(mean((r) => r.outputTokens).toFixed(0), 8),
        lpad(`$${mean((r) => r.cost).toFixed(4)}`, 10),
        lpad(`$${sum((r) => r.cost).toFixed(4)}`, 10),
      ].join(" ")
    );
  }
}

function printVerdictStability(results: RunResult[]): void {
  console.log("");
  console.log("=== Verdict stability vs baseline ===");
  console.log("");
  const byUser = new Map<string, Map<string, RunResult>>();
  for (const r of results) {
    if (r.error) continue;
    const m = byUser.get(r.username) ?? new Map<string, RunResult>();
    m.set(r.variantLabel, r);
    byUser.set(r.username, m);
  }

  const header = [
    pad("user", 16),
    pad("baseline", 16),
    pad("stripped", 16),
    pad("strip+det", 16),
    pad("det-only", 16),
    pad("matches?", 10),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const [user, m] of byUser) {
    const base = m.get("baseline");
    const stripped = m.get("stripped");
    const det = m.get("strip+det");
    const detOnly = m.get("det-only");
    const variants = [base, stripped, det, detOnly].filter(
      (r): r is RunResult => Boolean(r)
    );
    const verdictsMatch =
      base != null &&
      variants.every((r) => r.verdict === base.verdict);
    const personasMatch =
      base != null &&
      variants.every((r) => r.persona === base.persona);
    const cell = (r: RunResult | undefined): string =>
      r ? `${r.verdict}/${r.persona ?? "—"}` : "—";
    console.log(
      [
        pad(user.slice(0, 16), 16),
        pad(cell(base).slice(0, 16), 16),
        pad(cell(stripped).slice(0, 16), 16),
        pad(cell(det).slice(0, 16), 16),
        pad(cell(detOnly).slice(0, 16), 16),
        pad(verdictsMatch && personasMatch ? "✓" : "DIFF", 10),
      ].join(" ")
    );
  }
}

async function main(): Promise<void> {
  console.log(`Users (${usernames.length}): ${usernames.join(", ")}`);
  console.log(`Model: ${MODEL}`);
  console.log("");

  console.log("--- Phase 1: fetching all profiles (parallel) ---");
  const gathered = new Map<string, GatheredProfile>();
  await Promise.all(
    usernames.map(async (username) => {
      try {
        const g = await gatherProfile(username);
        gathered.set(username, g);
        console.log(
          `  u/${username}: posts=${g.summary.recent_posts.length}, comments=${g.summary.recent_comments.length}, customAvatar=${g.summary.avatar.customized}`
        );
      } catch (err) {
        console.error(
          `  u/${username}: FAILED — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
  console.log("");

  const results: RunResult[] = [];

  // For each variant, run all users sequentially so the prompt cache
  // state behaves predictably (first user of each variant = cold cache,
  // rest = warm).
  const variantSpecs: Array<{
    variant: "A" | "B" | "C" | "D";
    label: string;
    buildPrompt: (summary: ProfileSummary) => string;
    llmFactorKeys: readonly string[];
  }> = [
    {
      variant: "A",
      label: "baseline",
      buildPrompt: () => PROMPT_RAW,
      llmFactorKeys: ALL_FACTOR_KEYS,
    },
    {
      variant: "B",
      label: "stripped",
      buildPrompt: (s) =>
        assemblePrompt(PROMPT_RAW, s, { llmFactorKeys: ALL_FACTOR_KEYS }),
      llmFactorKeys: ALL_FACTOR_KEYS,
    },
    {
      variant: "C",
      label: "strip+det",
      buildPrompt: (s) =>
        assemblePrompt(PROMPT_RAW, s, { llmFactorKeys: SOFT_FACTOR_KEYS }),
      llmFactorKeys: SOFT_FACTOR_KEYS,
    },
    {
      variant: "D",
      label: "det-only",
      buildPrompt: (s) =>
        assemblePrompt(PROMPT_RAW, s, {
          llmFactorKeys: SOFT_FACTOR_KEYS,
          stripInputConditional: false,
        }),
      llmFactorKeys: SOFT_FACTOR_KEYS,
    },
  ];

  for (const spec of variantSpecs) {
    console.log(`--- Phase 2: variant ${spec.variant} (${spec.label}) ---`);
    for (const username of usernames) {
      const g = gathered.get(username);
      if (!g) {
        console.log(`  u/${username}: skipped (no profile)`);
        continue;
      }
      const prompt = spec.buildPrompt(g.summary);
      console.log(
        `  u/${username}: prompt=${prompt.length.toLocaleString()}c ...`
      );
      const result = await runVariant(
        spec.variant,
        spec.label,
        prompt,
        spec.llmFactorKeys,
        username,
        g.summary,
        g.avatarUrl
      );
      results.push(result);
      if (result.error) {
        console.log(`    → ERROR: ${result.error}`);
      } else {
        console.log(
          `    → $${result.cost.toFixed(4)} | ${result.verdict} | ${result.persona ?? "—"}`
        );
      }
    }
    console.log("");
  }

  printPerVariantTable(results);
  printAggregateTable(results);
  printVerdictStability(results);

  // Dump full results to JSON for any deeper analysis.
  const outPath = resolve(
    REPO_ROOT,
    `prompt-strip-experiment-${Date.now()}.json`
  );
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("");
  console.log(`Full results written to ${outPath}`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
