// CLI harness that runs the full bot/human investigation pipeline against
// a Reddit username, outside the browser extension. Lets us iterate on
// `src/features/investigation/prompt.md` without rebuilding/reloading the
// extension. Output mirrors the InvestigateUserResult shape the extension
// stores, so a JSON dump from here matches what the reports page sees.
//
// Usage:
//   npm run investigate -- <username> [--no-web-search] [--json]
//
// Requires CLAUDE_API_KEY in env.
//
// The DuckDuckGo search-rescue step IS replicated here. The DDG parser
// in src/features/web-search/fetch.ts uses `DOMParser`, which is native
// in the extension's background page; in Node we polyfill it via
// linkedom (a small spec-compliant DOM in pure JS) so the same parser
// works for both runtimes. Search-enriched ContextItems flow into the
// summary in-memory only (no `browser.storage`), so the CLI is
// stateless: it matches the extension's *pre-persist* state. Pass
// `--no-web-search` to skip the DDG step entirely if you want to test
// the prompt's no-rescue path.
//
// We intentionally bypass `bonInvestigateUser` from
// src/features/investigation/index.ts because that module pulls the
// prompt via Vite's `?raw` import suffix, which tsx/Node don't
// understand. Instead we read the prompt off disk and call the same
// underlying primitives (fetch → summarize → Claude → verdict) directly.
// Any drift between this script and the extension would be a bug in the
// pipeline composition, which is small and easy to keep aligned.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { DOMParser as LinkedomDOMParser } from "linkedom";

// Polyfill `DOMParser` for the Node CLI so the web-search parser in
// src/features/web-search/fetch.ts works without a code split. Must
// run BEFORE that module is imported transitively below.
(globalThis as unknown as { DOMParser: typeof LinkedomDOMParser }).DOMParser =
  LinkedomDOMParser;

import {
  bonFetchBotBouncerStatus,
  bonFetchRedditProfile,
  BON_REDDIT_FETCH_LIMIT,
  RedditFetchError,
} from "../src/features/investigation/fetch.ts";
import {
  bonExtractSnoovatarUrl,
  bonSummarizeProfile,
} from "../src/features/investigation/summarize.ts";
import { bonCallClaude } from "../src/features/investigation/api.ts";
import { bonWebSearchRedditUser } from "../src/features/web-search/index.ts";
import { bonExtractJson } from "../src/utils/json.ts";
import { bonNormalizePersona } from "../src/utils/persona.ts";
import { bonExtractActivityData } from "../src/utils/reddit_activity.ts";
import { bonComputeVerdict } from "../src/verdict.ts";
import { bonInferRegion } from "../src/features/regions/index.ts";
import { bonReportsInferTimezoneFromTimestamps } from "../src/features/reports/logic.ts";
import type { Factor } from "../src/types.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = resolve(REPO_ROOT, "src/features/investigation/prompt.md");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const username = positional[0];

if (!username) {
  console.error(
    "Usage: npm run investigate -- <username> [--no-web-search] [--json]"
  );
  process.exit(1);
}

const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing CLAUDE_API_KEY in environment.");
  process.exit(1);
}

const jsonOnly = flags.has("--json");
const webSearchEnabled = !flags.has("--no-web-search");

// Reddit's unauthenticated JSON endpoints rate-limit aggressively against
// generic UAs. The extension piggybacks on the user's browser UA; here we
// have to set one explicitly or we get a stream of 429s.
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
      headers.set("User-Agent", "bot-or-not-cli/1.0 (prompt-tuning harness)");
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const PROMPT = readFileSync(PROMPT_PATH, "utf8");

function log(...parts: unknown[]): void {
  if (!jsonOnly) console.log(...parts);
}

function formatRegion(
  region: ReturnType<typeof bonInferRegion>,
  timezone: ReturnType<typeof bonReportsInferTimezoneFromTimestamps>
): string {
  if (region && region.kind === "deterministic") {
    const sources: string[] = [];
    if (region.subreddit)
      sources.push(`subs(${region.subreddit.count} hits)`);
    if (region.scriptSignal)
      sources.push(`script(${region.scriptSignal.script})`);
    if (region.languageSignal) sources.push("language");
    if (region.moderator) sources.push("moderator");
    if (region.tzMatch === true) sources.push("tz✓");
    const runnerUp = region.runnerUp
      ? `, runner-up ${region.runnerUp.region} (${region.runnerUp.score})`
      : "";
    return `${region.region}  score=${region.score} [${sources.join(", ")}]${runnerUp}`;
  }
  if (region && region.kind === "timezone-only") {
    const sign = region.offsetHours >= 0 ? "+" : "";
    return `(tz only) UTC${sign}${region.offsetHours} — possible: ${region.possibleRegions.join(", ")}`;
  }
  if (timezone.kind === "flat") {
    return `(no region; flat posting pattern, ratio=${timezone.ratio.toFixed(2)})`;
  }
  if (timezone.kind === "insufficient") {
    return `(no region; only ${timezone.count} timestamps)`;
  }
  return "(no region inferred)";
}

async function main(): Promise<void> {
  log(`[investigate] fetching reddit data for u/${username}...`);

  // Three parallel fetches:
  //   profile (300 items, paginated) — feeds bonSummarizeProfile so Claude
  //     sees exactly what the auto-investigation would send, and feeds
  //     region inference (same depth as the reports-page activity view).
  //   botbouncer — separate active query, same as bonGatherProfile.
  //   web search (DDG) — surfaces cached posts/comments for hidden-profile
  //     rescue. Skipped when --no-web-search.
  const [profileSettled, botBouncerSettled, webSearchSettled] =
    await Promise.allSettled([
      bonFetchRedditProfile(username),
      bonFetchBotBouncerStatus(username),
      webSearchEnabled
        ? bonWebSearchRedditUser(username)
        : Promise.resolve(null),
    ]);

  if (profileSettled.status === "rejected") {
    const reason = profileSettled.reason;
    if (reason instanceof RedditFetchError) {
      console.error(`Reddit fetch failed: ${reason.message}`);
    } else {
      console.error("Reddit fetch failed:", reason);
    }
    process.exit(1);
  }

  const { profile } = profileSettled.value;
  const botBouncerStatus =
    botBouncerSettled.status === "fulfilled"
      ? botBouncerSettled.value.status
      : null;

  const postCount = profile.submitted.data?.children?.length ?? 0;
  const commentCount = profile.comments.data?.children?.length ?? 0;
  log(
    `[investigate] fetched posts=${postCount} comments=${commentCount} botbouncer=${botBouncerStatus ?? "none"}`
  );

  const webSearchResult =
    webSearchSettled.status === "fulfilled" ? webSearchSettled.value : null;
  const webSearchResults = webSearchResult?.results ?? [];
  if (webSearchEnabled) {
    log(`[investigate] web-search: ddg=${webSearchResults.length} results`);
  } else {
    log(`[investigate] web-search: skipped (--no-web-search)`);
  }

  const summary = bonSummarizeProfile(username, profile, {
    ...(botBouncerStatus
      ? { botBouncerStatus, botBouncerCheckedAt: Date.now() }
      : {}),
    webSearchResults,
  });

  log(
    `[investigate] calling Claude (web_search_results=${webSearchResults.length})...`
  );

  const avatarUrl = bonExtractSnoovatarUrl(profile);
  const claudeResult = await bonCallClaude(
    apiKey!,
    PROMPT,
    summary,
    "claude 1D",
    { avatarUrl }
  );

  const extracted = bonExtractJson(claudeResult.rawText);
  if (!extracted || typeof extracted !== "object") {
    console.error("Could not parse Claude response. Raw text:");
    console.error(claudeResult.rawText);
    process.exit(1);
  }

  const payload = extracted as Record<string, unknown>;
  if (!Array.isArray(payload.factors)) {
    console.error("Claude response missing `factors` array. Raw payload:");
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  const factors = payload.factors as Factor[];
  const persona = bonNormalizePersona(payload.persona);
  const claudeSummary =
    typeof payload.summary === "string" ? payload.summary : "";
  const verdict = bonComputeVerdict(factors);

  const activityData = bonExtractActivityData(
    profile,
    BON_REDDIT_FETCH_LIMIT
  );

  const timestamps = [
    ...(activityData.postTimestamps || []),
    ...(activityData.commentTimestamps || []),
  ];
  const timezone = bonReportsInferTimezoneFromTimestamps(timestamps);
  const region = bonInferRegion(activityData, timezone);

  const fullResult = {
    username,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    botProbability: verdict.botProbability,
    persona,
    summary: claudeSummary,
    factors,
    botBouncerStatus,
    region,
    timezone,
    postsFetched: postCount,
    commentsFetched: commentCount,
    accountCreatedAt: summary.account.created_at,
    accountAgeDays: summary.account.age_days,
    activityData,
    model: claudeResult.model,
    usage: claudeResult.usage,
    webSearchCount: 0,
    costUsd: claudeResult.costUsd,
    runAt: Date.now(),
  };

  if (jsonOnly) {
    console.log(JSON.stringify(fullResult, null, 2));
    return;
  }

  console.log("");
  console.log(`=== Verdict for u/${username} ===`);
  console.log(
    `${verdict.verdict}  (botProb=${verdict.botProbability.toFixed(3)}, confidence=${verdict.confidence.toFixed(3)})`
  );
  if (persona) {
    console.log(`Persona: ${persona.label} — ${persona.reasoning}`);
  }
  if (botBouncerStatus) {
    console.log(`BotBouncer: ${botBouncerStatus}`);
  }
  console.log(`Region: ${formatRegion(region, timezone)}`);

  console.log("");
  console.log("Summary:");
  console.log(`  ${claudeSummary}`);

  console.log("");
  console.log("Factors (score: -1=human signal, +1=bot signal):");
  for (const factor of factors) {
    const score =
      typeof factor.score === "number"
        ? (factor.score >= 0 ? "+" : "") + factor.score.toFixed(2)
        : "  n/a";
    const conf =
      typeof factor.confidence === "number"
        ? factor.confidence.toFixed(2)
        : "n/a";
    const reasoning = (factor.reasoning ?? "").replace(/\s+/g, " ");
    console.log(`  ${factor.key.padEnd(28)} ${score.padStart(6)}  c=${conf}  ${reasoning}`);
  }

  if (claudeResult.costUsd !== null) {
    console.log("");
    console.log(
      `Cost: $${claudeResult.costUsd.toFixed(4)}  (model=${claudeResult.model})`
    );
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
