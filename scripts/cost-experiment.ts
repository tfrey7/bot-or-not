// One-off A/B harness: run multiple variants of the investigation
// pipeline against ONE user, fetch Reddit data once, then call Claude N
// times across {model, item-count, timestamp-format, serializer} variants.
// Prints a comparison table of verdict + factor scores + tokens + cost.
//
// Usage: npm exec tsx scripts/cost-experiment.ts -- [username]
//
// Reads CLAUDE_API_KEY from env (source .env beforehand).
//
// Variants:
//   baseline       sonnet-4-6, 1000 items, ISO timestamps, verbose JSON
//   exp1           sonnet-4-6,  300 items, ISO timestamps, verbose JSON
//   exp3-haiku     haiku-4-5,  1000 items, ISO,            verbose JSON  (cascade triage step)
//   exp3-cascade   if haiku's botProb is in [0.3, 0.7], also call sonnet
//   exp4           sonnet-4-6, 1000 items, epoch-seconds,  verbose JSON
//   combo          cascade + 300 + epoch + verbose
//   exp5-compact   sonnet-4-6,  300 items, columnar JSON (epoch-minutes, sub-dedup, drop-nulls)
//   combo-compact  cascade + 300 + columnar JSON
//
// "Verbose JSON" = the original per-item-object shape used pre-compaction.
// "Columnar JSON" = the new compact shape with subs[]/posts.{cols,rows}/
//   comments.{cols,rows}, trailing-null-dropped rows, epoch-minutes timestamps.
//
// Sequential runs (not parallel) so prompt-cache hits land predictably.
// The system prompt is `cache_control: ephemeral` in api.ts, so a second
// sonnet call within 5 min reads the prompt at ~10% of input rate. This
// is realistic — the production extension gets the same benefit on
// back-to-back investigations.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  bonFetchBotBouncerStatus,
  bonFetchRedditProfile,
  RedditFetchError,
} from "../src/features/investigation/fetch.ts";
import {
  bonExtractSnoovatarUrl,
  bonSerializeProfileForClaude,
  bonSummarizeProfile,
} from "../src/features/investigation/summarize.ts";
import { bonInvestigationCallLlm } from "../src/features/investigation/api.ts";
import { bonExtractJson } from "../src/utils/json.ts";
import { bonNormalizePersona } from "../src/utils/persona.ts";
import { bonComputeVerdict } from "../src/verdict.ts";
import type { Factor, ProfileSummary } from "../src/types.ts";

const username = process.argv[2] ?? "Ask4MD";
const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing CLAUDE_API_KEY in env");
  process.exit(1);
}

// Reddit UA shim (lifted from investigate.ts).
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
      headers.set("User-Agent", "bot-or-not-cli/1.0 (cost-experiment)");
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT = readFileSync(
  resolve(REPO_ROOT, "src/features/investigation/prompt.md"),
  "utf8"
);

// --- Summary transformers ---

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function withLimit(summary: ProfileSummary, n: number): ProfileSummary {
  const out = clone(summary);
  out.recent_posts = out.recent_posts.slice(0, n);
  out.recent_comments = out.recent_comments.slice(0, n);
  return out;
}

// Serializer that emits the legacy per-item-object JSON shape (pre-compact).
// This is what production used to send before the columnar refactor. We
// pass it explicitly via InvestigationLlmOptions for the baseline / exp1-4 /
// combo variants so they remain apples-to-apples comparisons against the
// original production state. Variants tagged "compact" omit this and let
// bonInvestigationCallLlm default to bonSerializeProfileForClaude.
function verboseSerialize(summary: ProfileSummary): string {
  return JSON.stringify(summary);
}

// Rewrite all ISO created_at / checked_at values to epoch-second numbers,
// in place on a deep copy. Walks recursively; touches only matching keys.
function epochify(summary: ProfileSummary): ProfileSummary {
  const out = clone(summary);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if ((k === "created_at" || k === "checked_at") && typeof v === "string") {
        const t = Date.parse(v);
        if (!isNaN(t)) obj[k] = Math.floor(t / 1000);
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  };
  visit(out);
  return out;
}

// --- Variant runner ---

interface VariantResult {
  name: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  verdict: string;
  botProb: number;
  confidence: number;
  persona: string | null;
  factors: Factor[];
  durationMs: number;
}

async function runOnce(
  name: string,
  summary: ProfileSummary,
  model: string,
  avatarUrl: string | null,
  serialize: (s: ProfileSummary) => string = bonSerializeProfileForClaude
): Promise<VariantResult> {
  const t0 = Date.now();
  const claude = await bonInvestigationCallLlm(
    apiKey!,
    PROMPT,
    summary,
    `exp:${name}`,
    { avatarUrl, model, serialize }
  );
  const durationMs = Date.now() - t0;

  const extracted = bonExtractJson(claude.rawText) as Record<
    string,
    unknown
  > | null;
  const factors = Array.isArray(extracted?.factors)
    ? (extracted!.factors as Factor[])
    : [];
  const persona = bonNormalizePersona(extracted?.persona ?? null);
  const verdict = bonComputeVerdict(factors);

  const usage = claude.usage ?? {};
  return {
    name,
    model: claude.model,
    inputTokens: (usage as Record<string, number>).input_tokens ?? 0,
    outputTokens: (usage as Record<string, number>).output_tokens ?? 0,
    cacheReadTokens:
      (usage as Record<string, number>).cache_read_input_tokens ?? 0,
    cacheWriteTokens:
      (usage as Record<string, number>).cache_creation_input_tokens ?? 0,
    cost: claude.costUsd ?? 0,
    verdict: verdict.verdict,
    botProb: verdict.botProbability,
    confidence: verdict.confidence,
    persona: persona ? persona.label : null,
    factors,
    durationMs,
  };
}

// Cascade rule: trust Haiku unless its bot-probability lands in [0.3, 0.7]
// (genuinely ambiguous band), in which case re-run on Sonnet and use that
// result. Returns one VariantResult representing the cascade outcome,
// with cost summed across both calls.
const CASCADE_LOW = 0.3;
const CASCADE_HIGH = 0.7;

async function runCascade(
  name: string,
  summary: ProfileSummary,
  avatarUrl: string | null,
  haikuPrior: VariantResult | null,
  serialize: (s: ProfileSummary) => string = bonSerializeProfileForClaude
): Promise<VariantResult> {
  const haiku =
    haikuPrior ??
    (await runOnce(
      `${name}:haiku`,
      summary,
      "claude-haiku-4-5",
      avatarUrl,
      serialize
    ));
  if (haiku.botProb < CASCADE_LOW || haiku.botProb > CASCADE_HIGH) {
    return { ...haiku, name: `${name} (haiku-only)` };
  }
  const sonnet = await runOnce(
    `${name}:sonnet`,
    summary,
    "claude-sonnet-4-6",
    avatarUrl,
    serialize
  );
  return {
    ...sonnet,
    name: `${name} (haiku→sonnet)`,
    cost: haiku.cost + sonnet.cost,
    inputTokens: haiku.inputTokens + sonnet.inputTokens,
    outputTokens: haiku.outputTokens + sonnet.outputTokens,
    cacheReadTokens: haiku.cacheReadTokens + sonnet.cacheReadTokens,
    cacheWriteTokens: haiku.cacheWriteTokens + sonnet.cacheWriteTokens,
    durationMs: haiku.durationMs + sonnet.durationMs,
  };
}

// --- Reporting ---

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function lpad(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function printSummary(results: VariantResult[]): void {
  console.log("");
  console.log("=== Variant comparison ===");
  console.log("");
  const header = [
    pad("variant", 36),
    pad("model", 22),
    lpad("in", 8),
    lpad("cache-rd", 9),
    lpad("out", 6),
    lpad("cost", 9),
    lpad("Δ$ vs base", 11),
    pad("verdict", 16),
    lpad("botProb", 8),
    pad("persona", 12),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  const baseCost = results[0]?.cost ?? 0;
  for (const r of results) {
    const delta = baseCost > 0 ? (r.cost - baseCost) / baseCost : 0;
    const deltaStr =
      r === results[0]
        ? "—"
        : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`;
    console.log(
      [
        pad(r.name, 36),
        pad(r.model, 22),
        lpad(r.inputTokens.toLocaleString(), 8),
        lpad(r.cacheReadTokens.toLocaleString(), 9),
        lpad(r.outputTokens.toLocaleString(), 6),
        lpad(`$${r.cost.toFixed(4)}`, 9),
        lpad(deltaStr, 11),
        pad(r.verdict, 16),
        lpad(r.botProb.toFixed(3), 8),
        pad(r.persona ?? "—", 12),
      ].join(" ")
    );
  }
}

function printFactorDeltas(results: VariantResult[]): void {
  const base = results[0];
  if (!base) return;
  console.log("");
  console.log("=== Factor-score deltas vs baseline (≥0.10 highlighted) ===");
  console.log("");
  const factorKeys = base.factors.map((f) => f.key);
  const head = [
    pad("factor", 28),
    ...results.map((r) => lpad(r.name.slice(0, 11), 12)),
  ].join(" ");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const key of factorKeys) {
    const cells = results.map((r) => {
      const f = r.factors.find((x) => x.key === key);
      const score = typeof f?.score === "number" ? f.score : null;
      if (score === null) return lpad("n/a", 12);
      const sign = score >= 0 ? "+" : "";
      return lpad(`${sign}${score.toFixed(2)}`, 12);
    });
    console.log([pad(key, 28), ...cells].join(" "));
  }
}

// --- Main ---

async function main(): Promise<void> {
  console.log(`Fetching reddit data for u/${username}...`);
  const [profileRes, bbRes] = await Promise.allSettled([
    bonFetchRedditProfile(username),
    bonFetchBotBouncerStatus(username),
  ]);
  if (profileRes.status === "rejected") {
    const reason = profileRes.reason;
    if (reason instanceof RedditFetchError) {
      console.error(`Reddit fetch failed: ${reason.message}`);
    } else {
      console.error("Reddit fetch failed:", reason);
    }
    process.exit(1);
  }
  const { profile } = profileRes.value;
  const bbStatus = bbRes.status === "fulfilled" ? bbRes.value.status : null;

  const extra: Record<string, unknown> = {};
  if (bbStatus) {
    extra.botBouncerStatus = bbStatus;
    extra.botBouncerCheckedAt = Date.now();
  }
  const baseSummary = bonSummarizeProfile(username, profile, extra);
  const avatarUrl = bonExtractSnoovatarUrl(profile);
  console.log(
    `Fetched: posts=${baseSummary.recent_posts.length}, comments=${baseSummary.recent_comments.length}`
  );
  console.log("");

  const sum300 = withLimit(baseSummary, 300);
  const sumEpoch = epochify(baseSummary);
  const sumCombo = epochify(withLimit(baseSummary, 300));

  const results: VariantResult[] = [];

  // 1. baseline — verbose JSON, what production used to send
  console.log(">>> running: baseline (sonnet, 1000, ISO, verbose)");
  results.push(
    await runOnce(
      "baseline (sonnet, 1000, ISO, verbose)",
      baseSummary,
      "claude-sonnet-4-6",
      avatarUrl,
      verboseSerialize
    )
  );

  // 2. exp1 — limit 300
  console.log(">>> running: exp1 (sonnet, 300, ISO, verbose)");
  results.push(
    await runOnce(
      "exp1 (sonnet, 300, ISO, verbose)",
      sum300,
      "claude-sonnet-4-6",
      avatarUrl,
      verboseSerialize
    )
  );

  // 3. exp3 — cascade with full payload. Run haiku once, then maybe sonnet.
  console.log(
    ">>> running: exp3 (cascade, 1000, ISO, verbose) — haiku triage first"
  );
  const haikuFull = await runOnce(
    "exp3-triage (haiku, 1000, verbose)",
    baseSummary,
    "claude-haiku-4-5",
    avatarUrl,
    verboseSerialize
  );
  results.push(haikuFull);
  const cascadeFull = await runCascade(
    "exp3-cascade (verbose)",
    baseSummary,
    avatarUrl,
    haikuFull,
    verboseSerialize
  );
  results.push(cascadeFull);

  // 4. exp4 — epoch timestamps
  console.log(">>> running: exp4 (sonnet, 1000, epoch, verbose)");
  results.push(
    await runOnce(
      "exp4 (sonnet, 1000, epoch, verbose)",
      sumEpoch,
      "claude-sonnet-4-6",
      avatarUrl,
      verboseSerialize
    )
  );

  // 5. combo — cascade + 300 + epoch
  console.log(">>> running: combo (cascade, 300, epoch, verbose)");
  const comboCascade = await runCascade(
    "combo (cascade, 300, epoch, verbose)",
    sumCombo,
    avatarUrl,
    null,
    verboseSerialize
  );
  results.push(comboCascade);

  // 6. exp5-compact — sonnet + 300 + columnar JSON (sub-dedup, drop-nulls,
  //    epoch-minutes). No need to pre-epochify the summary because the
  //    compact serializer handles its own timestamp conversion.
  console.log(">>> running: exp5-compact (sonnet, 300, columnar)");
  results.push(
    await runOnce(
      "exp5-compact (sonnet, 300, columnar)",
      sum300,
      "claude-sonnet-4-6",
      avatarUrl
    )
  );

  // 7. combo-compact — cascade + 300 + columnar JSON
  console.log(">>> running: combo-compact (cascade, 300, columnar)");
  const comboCompact = await runCascade(
    "combo-compact (cascade, 300, columnar)",
    sum300,
    avatarUrl,
    null
  );
  results.push(comboCompact);

  printSummary(results);
  printFactorDeltas(results);
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
