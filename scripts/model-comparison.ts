// One-shot experiment: fetch each user's Reddit data + summary ONCE,
// then call Claude N times across different models against the
// identical input. Compares verdict, persona, factors, latency, cost.
//
// Usage:
//   npm exec tsx scripts/model-comparison.ts -- <user1> <user2> ...
//
// Reads CLAUDE_API_KEY from env (npm run investigate sources .env).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  bonFetchBotBouncerStatus,
  bonFetchRedditProfile,
  RedditFetchError,
} from "../src/features/investigation/fetch.ts";
import {
  bonExtractSnoovatarUrl,
  bonSummarizeProfile,
} from "../src/features/investigation/summarize.ts";
import { bonInvestigationCallLlm } from "../src/features/investigation/api.ts";
import { bonExtractJson } from "../src/utils/json.ts";
import { bonNormalizePersona } from "../src/utils/persona.ts";
import { bonComputeVerdict } from "../src/verdict.ts";
import type { Factor } from "../src/types.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = resolve(REPO_ROOT, "src/features/investigation/prompt.md");
const PROMPT = readFileSync(PROMPT_PATH, "utf8");

const MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
];

const rawArgs = process.argv.slice(2);
let maxItems: number | null = null;
const usernames: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "--max-items" && i + 1 < rawArgs.length) {
    maxItems = Number(rawArgs[++i]);
  } else if (a.startsWith("--max-items=")) {
    maxItems = Number(a.slice("--max-items=".length));
  } else {
    usernames.push(a);
  }
}
if (usernames.length === 0) {
  console.error("Usage: tsx scripts/model-comparison.ts <user1> <user2> ...");
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
      headers.set("User-Agent", "bot-or-not-cli/1.0 (model-comparison)");
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
}) as typeof fetch;

interface ModelRun {
  model: string;
  verdict: string;
  botProbability: number;
  confidence: number;
  personaLabel: string | null;
  personaTopAxes: Array<[string, number]>;
  summary: string;
  factorScores: Record<string, number>;
  costUsd: number | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

interface UserResult {
  username: string;
  postsFetched: number;
  commentsFetched: number;
  botBouncerStatus: string | null;
  runs: ModelRun[];
}

async function investigateUser(username: string): Promise<UserResult> {
  console.error(`[${username}] fetching reddit...`);
  const [profileSettled, botBouncerSettled] = await Promise.allSettled([
    bonFetchRedditProfile(username),
    bonFetchBotBouncerStatus(username),
  ]);

  if (profileSettled.status === "rejected") {
    const reason = profileSettled.reason;
    if (reason instanceof RedditFetchError) {
      throw new Error(`Reddit fetch failed for ${username}: ${reason.message}`);
    }
    throw reason;
  }

  const { profile } = profileSettled.value;
  const botBouncerStatus =
    botBouncerSettled.status === "fulfilled"
      ? botBouncerSettled.value.status
      : null;

  const postCount = profile.submitted.data?.children?.length ?? 0;
  const commentCount = profile.comments.data?.children?.length ?? 0;
  console.error(
    `[${username}] posts=${postCount} comments=${commentCount} bb=${botBouncerStatus ?? "none"}`
  );

  const summary = bonSummarizeProfile(username, profile, {
    ...(botBouncerStatus
      ? { botBouncerStatus, botBouncerCheckedAt: Date.now() }
      : {}),
  });
  if (maxItems !== null) {
    const beforeP = summary.recent_posts.length;
    const beforeC = summary.recent_comments.length;
    summary.recent_posts = summary.recent_posts.slice(0, maxItems);
    summary.recent_comments = summary.recent_comments.slice(0, maxItems);
    console.error(
      `[${username}] downsampled posts ${beforeP}->${summary.recent_posts.length}, comments ${beforeC}->${summary.recent_comments.length}`
    );
  }
  const avatarUrl = bonExtractSnoovatarUrl(profile);

  const runs: ModelRun[] = [];
  for (const model of MODELS) {
    console.error(`[${username}] calling ${model}...`);
    const start = performance.now();
    const result = await bonInvestigationCallLlm(
      apiKey!,
      PROMPT,
      summary,
      model,
      { avatarUrl, model }
    );
    const latencyMs = Math.round(performance.now() - start);

    const extracted = bonExtractJson(result.rawText);
    if (!extracted || typeof extracted !== "object") {
      console.error(`[${username}] ${model}: failed to parse JSON`);
      console.error(result.rawText.slice(0, 500));
      continue;
    }
    const payload = extracted as Record<string, unknown>;
    if (!Array.isArray(payload.factors)) {
      console.error(`[${username}] ${model}: missing factors`);
      continue;
    }

    const factors = payload.factors as Factor[];
    const persona = bonNormalizePersona(payload.persona);
    const verdict = bonComputeVerdict(factors);
    const claudeSummary =
      typeof payload.summary === "string" ? payload.summary : "";

    const factorScores: Record<string, number> = {};
    for (const f of factors) {
      if (typeof f.score === "number") factorScores[f.key] = f.score;
    }

    const archetypes = persona?.archetypes ?? {};
    const topAxes = Object.entries(archetypes)
      .filter(([, v]) => typeof v === "number")
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3) as Array<[string, number]>;

    runs.push({
      model: result.model,
      verdict: verdict.verdict,
      botProbability: verdict.botProbability,
      confidence: verdict.confidence,
      personaLabel: persona?.label ?? null,
      personaTopAxes: topAxes,
      summary: claudeSummary,
      factorScores,
      costUsd: result.costUsd,
      latencyMs,
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
      cacheCreateTokens: result.usage?.cache_creation_input_tokens ?? 0,
    });
  }

  return {
    username,
    postsFetched: postCount,
    commentsFetched: commentCount,
    botBouncerStatus,
    runs,
  };
}

function printTable(results: UserResult[]): void {
  console.log("");
  console.log("=== Per-user model comparison ===");
  for (const r of results) {
    console.log("");
    console.log(
      `u/${r.username}  (posts=${r.postsFetched}, comments=${r.commentsFetched}, bb=${r.botBouncerStatus ?? "-"})`
    );
    console.log(
      "  " +
        "model".padEnd(22) +
        "verdict".padEnd(14) +
        "botP".padEnd(7) +
        "conf".padEnd(7) +
        "persona".padEnd(12) +
        "lat(ms)".padEnd(9) +
        "in/out".padEnd(12) +
        "cost"
    );
    for (const run of r.runs) {
      const tokens = `${run.inputTokens}/${run.outputTokens}`;
      const cacheNote =
        run.cacheReadTokens > 0
          ? ` (cR=${run.cacheReadTokens})`
          : run.cacheCreateTokens > 0
            ? ` (cW=${run.cacheCreateTokens})`
            : "";
      console.log(
        "  " +
          run.model.padEnd(22) +
          run.verdict.padEnd(14) +
          run.botProbability.toFixed(2).padEnd(7) +
          run.confidence.toFixed(2).padEnd(7) +
          (run.personaLabel ?? "-").padEnd(12) +
          String(run.latencyMs).padEnd(9) +
          tokens.padEnd(12) +
          (run.costUsd !== null ? `$${run.costUsd.toFixed(4)}` : "?") +
          cacheNote
      );
    }
    console.log("  summaries:");
    for (const run of r.runs) {
      console.log(`    ${run.model}:`);
      console.log(`      ${run.summary}`);
    }
    console.log("  top archetypes:");
    for (const run of r.runs) {
      const axes = run.personaTopAxes
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(", ");
      console.log(`    ${run.model}: ${axes}`);
    }
  }

  console.log("");
  console.log("=== Verdict-agreement matrix ===");
  for (const r of results) {
    const verdicts = r.runs.map((x) => x.verdict);
    const agree =
      verdicts.length > 1 && verdicts.every((v) => v === verdicts[0]);
    console.log(
      `  u/${r.username.padEnd(22)} ${verdicts.join(" | ")}  ${agree ? "✓ agree" : "✗ DIVERGE"}`
    );
  }

  console.log("");
  console.log("=== Cost totals per model (this run) ===");
  const totals: Record<string, { cost: number; lat: number; n: number }> = {};
  for (const r of results) {
    for (const run of r.runs) {
      const key = run.model.replace(/-\d{8}$/, "");
      if (!totals[key]) totals[key] = { cost: 0, lat: 0, n: 0 };
      if (run.costUsd !== null) totals[key].cost += run.costUsd;
      totals[key].lat += run.latencyMs;
      totals[key].n += 1;
    }
  }
  for (const [model, t] of Object.entries(totals)) {
    console.log(
      `  ${model.padEnd(28)} total $${t.cost.toFixed(4)}  avg $${(t.cost / t.n).toFixed(4)}/call  avg ${Math.round(t.lat / t.n)}ms`
    );
  }
}

async function main(): Promise<void> {
  const results: UserResult[] = [];
  for (const u of usernames) {
    try {
      results.push(await investigateUser(u));
    } catch (err) {
      console.error(
        `[${u}] failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  printTable(results);

  const outPath = resolve(REPO_ROOT, "/tmp/model-comparison.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.error(`\nFull JSON dump: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
