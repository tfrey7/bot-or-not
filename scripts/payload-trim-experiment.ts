// 4-variant A/B/C/D experiment on the user-message payload — the
// 64%-of-cost line the prompt-compression experiment surfaced.
//
//   A. baseline    — current behaviour: post selftext to 400c, comment
//                    body to 500c, all items kept.
//   B. trunc       — same item set, body excerpts re-truncated to 200c.
//   C. drop-empty  — current truncation, but items whose body is empty,
//                    `[removed]`, or `[deleted]` are dropped. Aggregate
//                    counts (`posts_fetched`, `comments_fetched`,
//                    `posting_rate`, `top_subreddits`, `moderator_removals`)
//                    stay computed over the FULL set so factor math
//                    doesn't shift — only the per-item arrays the LLM
//                    reads are filtered.
//   D. trunc+drop  — both.
//
// All four variants share an identical system prompt, so they share one
// 1h prompt-cache slot — only the FIRST call pays the cache write; the
// rest hit cache-read pricing. The variable line in the bill is the
// uncached user-message input ($3/M on Sonnet), which is exactly what
// these transformations attack.
//
// Verdict stability is the success criterion — a saving is only banked
// if the verdict + persona + region match the baseline.
//
// Usage:
//   npm exec tsx scripts/payload-trim-experiment.ts -- <user1> <user2> ...
//   # default users = the reference-account memory set

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
const TRUNC_BODY_CHARS = 200;

type VariantLabel = "baseline" | "trunc" | "drop-empty" | "trunc+drop";
type VariantId = "A" | "B" | "C" | "D";

const usernames =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_USERS;

const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing CLAUDE_API_KEY in env");
  process.exit(1);
}

// Reddit UA shim — same as other experiment scripts.
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
      headers.set("User-Agent", "bot-or-not-cli/1.0 (payload-trim-experiment)");
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
const LLM_FACTOR_KEYS = FACTORS.map((f) => f.key).filter(
  (k) => !(DETERMINISTIC_FACTOR_KEYS as readonly string[]).includes(k)
);

// "Body has no usable content" — what Reddit emits when the item is
// removed/deleted or when the user posted no selftext. Empty text + empty
// body produces zero classifier signal but still costs row overhead in
// the columnar payload.
function isEmptyText(text: string | null | undefined): boolean {
  if (text == null) {
    return true;
  }
  const stripped = text.trim();
  return (
    stripped === "" ||
    stripped === "[removed]" ||
    stripped === "[deleted]"
  );
}

function truncateBody(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

// Apply the variant's transformation to a canonical ProfileSummary. We
// keep all aggregate signals (posts_fetched, top_subreddits, posting_rate,
// moderator_removals) computed over the FULL pre-filter set so factor
// math is unaffected — only the per-item arrays the LLM reads are
// modified.
function applyVariant(
  summary: ProfileSummary,
  variant: VariantLabel
): ProfileSummary {
  const truncate = variant === "trunc" || variant === "trunc+drop";
  const dropEmpty = variant === "drop-empty" || variant === "trunc+drop";

  const posts = summary.recent_posts
    .filter((p) =>
      !dropEmpty
        ? true
        : !(isEmptyText(p.selftext_excerpt) && (p.title ?? "").trim() === "")
    )
    .map((p) => ({
      ...p,
      selftext_excerpt: truncate
        ? truncateBody(p.selftext_excerpt, TRUNC_BODY_CHARS)
        : p.selftext_excerpt,
    }));

  const comments = summary.recent_comments
    .filter((c) => (!dropEmpty ? true : !isEmptyText(c.body_excerpt)))
    .map((c) => ({
      ...c,
      body_excerpt: truncate
        ? truncateBody(c.body_excerpt, TRUNC_BODY_CHARS)
        : c.body_excerpt,
    }));

  return {
    ...summary,
    recent_posts: posts,
    recent_comments: comments,
  };
}

interface RunResult {
  variant: VariantId;
  variantLabel: VariantLabel;
  username: string;
  model: string;
  promptChars: number;
  postsAfter: number;
  commentsAfter: number;
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
  variant: VariantId,
  label: VariantLabel,
  prompt: string,
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

    const detFactors = scoreDeterministicFactors(summary);
    const finalFactors = mergeFactors(llmFactors, detFactors);

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
      postsAfter: summary.recent_posts.length,
      commentsAfter: summary.recent_comments.length,
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
      postsAfter: summary.recent_posts.length,
      commentsAfter: summary.recent_comments.length,
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
    lpad("p/c", 8),
    lpad("in", 7),
    lpad("cache-rd", 9),
    lpad("cache-wr", 9),
    lpad("out", 5),
    lpad("cost", 8),
    pad("verdict", 14),
    lpad("botProb", 8),
    pad("persona", 10),
    pad("region", 7),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log(
      [
        pad(r.username.slice(0, 16), 16),
        pad(r.variantLabel, 12),
        lpad(`${r.postsAfter}/${r.commentsAfter}`, 8),
        lpad(r.inputTokens.toLocaleString(), 7),
        lpad(r.cacheReadTokens.toLocaleString(), 9),
        lpad(r.cacheWriteTokens.toLocaleString(), 9),
        lpad(r.outputTokens.toLocaleString(), 5),
        lpad(`$${r.cost.toFixed(4)}`, 8),
        pad(r.error ? "ERROR" : r.verdict, 14),
        lpad(r.botProb.toFixed(3), 8),
        pad(r.persona ?? "—", 10),
        pad(r.region ?? "—", 7),
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
    pad("variant", 12),
    lpad("n", 3),
    lpad("avg in", 9),
    lpad("avg cache-rd", 13),
    lpad("avg cache-wr", 13),
    lpad("avg out", 8),
    lpad("avg cost", 10),
    lpad("sum cost", 10),
    lpad("vs base", 9),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  const variantOrder: VariantLabel[] = [
    "baseline",
    "trunc",
    "drop-empty",
    "trunc+drop",
  ];
  let baselineSum = 0;
  for (const label of variantOrder) {
    const list = byVariant.get(label);
    if (!list || list.length === 0) continue;
    const n = list.length;
    const mean = (fn: (r: RunResult) => number): number =>
      list.reduce((s, r) => s + fn(r), 0) / n;
    const sum = (fn: (r: RunResult) => number): number =>
      list.reduce((s, r) => s + fn(r), 0);
    const totalCost = sum((r) => r.cost);
    if (label === "baseline") {
      baselineSum = totalCost;
    }
    const pctVsBase =
      baselineSum > 0
        ? `${((totalCost / baselineSum - 1) * 100).toFixed(1)}%`
        : "—";
    console.log(
      [
        pad(label, 12),
        lpad(String(n), 3),
        lpad(mean((r) => r.inputTokens).toFixed(0), 9),
        lpad(mean((r) => r.cacheReadTokens).toFixed(0), 13),
        lpad(mean((r) => r.cacheWriteTokens).toFixed(0), 13),
        lpad(mean((r) => r.outputTokens).toFixed(0), 8),
        lpad(`$${mean((r) => r.cost).toFixed(4)}`, 10),
        lpad(`$${totalCost.toFixed(4)}`, 10),
        lpad(pctVsBase, 9),
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
    pad("baseline", 22),
    pad("trunc", 22),
    pad("drop-empty", 22),
    pad("trunc+drop", 22),
    pad("v?", 4),
    pad("p?", 4),
    pad("r?", 4),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  const tally = {
    trunc: { verdict: 0, persona: 0, region: 0, total: 0 },
    "drop-empty": { verdict: 0, persona: 0, region: 0, total: 0 },
    "trunc+drop": { verdict: 0, persona: 0, region: 0, total: 0 },
  };
  for (const [user, m] of byUser) {
    const base = m.get("baseline");
    const trunc = m.get("trunc");
    const drop = m.get("drop-empty");
    const both = m.get("trunc+drop");
    if (!base) continue;
    const cell = (r: RunResult | undefined): string =>
      r ? `${r.verdict}/${r.persona ?? "—"}/${r.region ?? "—"}` : "—";
    const matchAll = (r: RunResult | undefined): boolean =>
      r != null &&
      r.verdict === base.verdict &&
      r.persona === base.persona &&
      r.region === base.region;

    for (const [name, r] of [
      ["trunc", trunc],
      ["drop-empty", drop],
      ["trunc+drop", both],
    ] as const) {
      if (!r) continue;
      tally[name].total += 1;
      if (r.verdict === base.verdict) tally[name].verdict += 1;
      if (r.persona === base.persona) tally[name].persona += 1;
      if (r.region === base.region) tally[name].region += 1;
    }

    console.log(
      [
        pad(user.slice(0, 16), 16),
        pad(cell(base).slice(0, 22), 22),
        pad(cell(trunc).slice(0, 22), 22),
        pad(cell(drop).slice(0, 22), 22),
        pad(cell(both).slice(0, 22), 22),
        pad(matchAll(trunc) && matchAll(drop) && matchAll(both) ? "✓" : "·", 4),
        pad("", 4),
        pad("", 4),
      ].join(" ")
    );
  }
  console.log("");
  for (const [name, t] of Object.entries(tally)) {
    if (t.total === 0) continue;
    console.log(
      `${pad(name, 12)}  verdicts ${t.verdict}/${t.total}  ·  personas ${t.persona}/${t.total}  ·  regions ${t.region}/${t.total}`
    );
  }
}

function printFactorDeltas(results: RunResult[]): void {
  console.log("");
  console.log("=== Per-factor avg |Δ| (vs baseline) ===");
  console.log("");
  const byUser = new Map<string, Map<string, RunResult>>();
  for (const r of results) {
    if (r.error) continue;
    const m = byUser.get(r.username) ?? new Map<string, RunResult>();
    m.set(r.variantLabel, r);
    byUser.set(r.username, m);
  }

  const variants: VariantLabel[] = ["trunc", "drop-empty", "trunc+drop"];
  const factorOrder = FACTORS.map((f) => f.key);

  const header = [
    pad("factor", 28),
    lpad("trunc avgΔ", 11),
    lpad("trunc maxΔ", 11),
    lpad("drop avgΔ", 11),
    lpad("drop maxΔ", 11),
    lpad("both avgΔ", 11),
    lpad("both maxΔ", 11),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const key of factorOrder) {
    const cells: Record<VariantLabel, number[]> = {
      baseline: [],
      trunc: [],
      "drop-empty": [],
      "trunc+drop": [],
    };
    for (const [, m] of byUser) {
      const base = m.get("baseline");
      if (!base) continue;
      const baseScore = base.factors.find((f) => f.key === key)?.score ?? 0;
      for (const v of variants) {
        const r = m.get(v);
        if (!r) continue;
        const score = r.factors.find((f) => f.key === key)?.score ?? 0;
        cells[v].push(score - baseScore);
      }
    }
    const avg = (xs: number[]): number =>
      xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
    const maxAbs = (xs: number[]): number =>
      xs.length === 0 ? 0 : Math.max(...xs.map(Math.abs));
    console.log(
      [
        pad(key, 28),
        lpad(avg(cells.trunc).toFixed(3), 11),
        lpad(maxAbs(cells.trunc).toFixed(3), 11),
        lpad(avg(cells["drop-empty"]).toFixed(3), 11),
        lpad(maxAbs(cells["drop-empty"]).toFixed(3), 11),
        lpad(avg(cells["trunc+drop"]).toFixed(3), 11),
        lpad(maxAbs(cells["trunc+drop"]).toFixed(3), 11),
      ].join(" ")
    );
  }
}

async function main(): Promise<void> {
  console.log(`Users (${usernames.length}): ${usernames.join(", ")}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Truncation cap (trunc variants): ${TRUNC_BODY_CHARS} chars`);
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

  const variantSpecs: Array<{
    variant: VariantId;
    label: VariantLabel;
  }> = [
    { variant: "A", label: "baseline" },
    { variant: "B", label: "trunc" },
    { variant: "C", label: "drop-empty" },
    { variant: "D", label: "trunc+drop" },
  ];

  for (const spec of variantSpecs) {
    console.log(`--- Phase 2: variant ${spec.variant} (${spec.label}) ---`);
    for (const username of usernames) {
      const g = gathered.get(username);
      if (!g) {
        console.log(`  u/${username}: skipped (no profile)`);
        continue;
      }
      const variantSummary = applyVariant(g.summary, spec.label);
      const prompt = assemblePrompt(PROMPT_RAW, variantSummary, {
        llmFactorKeys: LLM_FACTOR_KEYS,
        stripInputConditional: false,
      });
      console.log(
        `  u/${username}: posts=${variantSummary.recent_posts.length} comments=${variantSummary.recent_comments.length} prompt=${prompt.length.toLocaleString()}c ...`
      );
      const result = await runVariant(
        spec.variant,
        spec.label,
        prompt,
        username,
        variantSummary,
        g.avatarUrl
      );
      results.push(result);
      if (result.error) {
        console.log(`    → ERROR: ${result.error}`);
      } else {
        console.log(
          `    → $${result.cost.toFixed(4)} | ${result.verdict} | ${result.persona ?? "—"} | ${result.region ?? "—"}`
        );
      }
    }
    console.log("");
  }

  printPerVariantTable(results);
  printAggregateTable(results);
  printVerdictStability(results);
  printFactorDeltas(results);

  const outPath = resolve(
    REPO_ROOT,
    `payload-trim-experiment-${Date.now()}.json`
  );
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("");
  console.log(`Full results written to ${outPath}`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
