// Runs the investigation pipeline against the reference-account fixtures
// and diffs the results against the hand-judged expectations in
// reference_accounts.ts. Run after any prompt or verdict-math change.
//
// Comparison is soft (verdict within the expected band list, expected
// persona within the label or top-2 archetypes) because LLM scoring is
// nondeterministic. Each account costs one Claude call (~$0.25).
//
// Usage:
//   npm run regress               -- all reference accounts with fixtures
//   npm run regress -- user1 ...  -- a subset
//
// Requires fixtures/<user>.json (see `npm run harvest` / `npm run ingest`)
// and CLAUDE_API_KEY in .env.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RED_FLAG_LIKELY_BOT_COUNT } from "../src/verdict.ts";
import { REFERENCE_ACCOUNTS } from "./reference_accounts.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const INVESTIGATE = join(REPO_ROOT, "scripts", "investigate.ts");

interface InvestigationResult {
  verdict: string;
  botProbability: number;
  persona: { label: string; archetypes: Record<string, number> } | null;
  costUsd: number | null;
  deterministicRedFlags: number;
}

const requested = process.argv.slice(2);
const accounts =
  requested.length > 0
    ? REFERENCE_ACCOUNTS.filter((a) => requested.includes(a.username))
    : REFERENCE_ACCOUNTS;

if (requested.length > 0 && accounts.length !== requested.length) {
  const known = new Set(accounts.map((a) => a.username));
  const unknown = requested.filter((u) => !known.has(u));
  console.error(`Not in reference_accounts.ts: ${unknown.join(", ")}`);
  process.exit(1);
}

let failures = 0;
let totalCost = 0;

for (const account of accounts) {
  const fixturePath = join(REPO_ROOT, "fixtures", `${account.username}.json`);
  if (!existsSync(fixturePath)) {
    console.log(`SKIP  ${account.username} — no fixture (npm run harvest)`);
    continue;
  }

  const stdout = execFileSync(
    TSX_BIN,
    [INVESTIGATE, account.username, "--fixture", fixturePath, "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  // The LLM layer logs a timing line to stdout ahead of the JSON payload.
  const result = JSON.parse(
    stdout.slice(stdout.indexOf("{"))
  ) as InvestigationResult;
  totalCost += result.costUsd ?? 0;

  const verdictOk = account.expectVerdicts.includes(result.verdict);

  const personaLabel = result.persona?.label ?? "none";
  const archetypes = result.persona?.archetypes ?? {};
  const top2 = Object.entries(archetypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => key);
  const personaOk = account.expectPersonas.some(
    (expected) => expected === personaLabel || top2.includes(expected)
  );

  // An auto-triggered run would skip the LLM entirely when the gate trips.
  // Fine for expected-bot accounts (the fast-tracked verdict lands on the
  // right side); a hand-judged human or nuanced account tripping it means
  // the deterministic signals are wrong — fail loudly, don't tune around it.
  const gateTripped = result.deterministicRedFlags >= RED_FLAG_LIKELY_BOT_COUNT;
  const gateOk =
    !gateTripped ||
    account.expectVerdicts.some(
      (verdict) => verdict === "bot" || verdict === "likely-bot"
    );

  const status = verdictOk && personaOk && gateOk ? "PASS" : "FAIL";
  if (status === "FAIL") {
    failures++;
  }

  console.log(
    `${status}  ${account.username.padEnd(16)} verdict=${result.verdict} (${result.botProbability.toFixed(3)})` +
      ` persona=${personaLabel} top2=[${top2.join(", ")}]` +
      `  expected verdict∈[${account.expectVerdicts.join(", ")}] persona∈[${account.expectPersonas.join(", ")}]` +
      (gateTripped ? `  fast-track gate: ${result.deterministicRedFlags} red flags${gateOk ? "" : " — NOT expected bot-side"}` : "")
  );
}

console.log("");
console.log(
  `${failures === 0 ? "All passed" : `${failures} FAILED`} — total cost $${totalCost.toFixed(2)}`
);
process.exit(failures === 0 ? 0 : 1);
