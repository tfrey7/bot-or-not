// Triangle classifier analyzer (beta). Runs in parallel with bot_analysis.js
// against the same Reddit profile data; produces a barycentric { bot, stan,
// farmer } blend instead of a 1D bot↔human verdict.
//
// Reuses helpers from bot_analysis.js (bonSummarizeProfile, bonCallClaude,
// bonExtractJson, bonFetchRedditProfile, bonFetchBotBouncerStatus). Both
// scripts are loaded in the background context so the globals are accessible.

let bonCachedTrianglePrompt = null;

async function bonLoadTrianglePrompt() {
  if (bonCachedTrianglePrompt) return bonCachedTrianglePrompt;
  const url = browser.runtime.getURL("src/triangle/bot_analysis_triangle.md");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load bot_analysis_triangle.md (${res.status})`);
  }
  bonCachedTrianglePrompt = await res.text();
  return bonCachedTrianglePrompt;
}

function bonResetTrianglePromptCache() {
  bonCachedTrianglePrompt = null;
}

// Drives the triangle analysis against an already-fetched profile summary.
// Caller is responsible for fetching the profile + BotBouncer status (done
// once per investigation; both analyses share that input).
async function bonInvestigateUserTriangle(apiKey, profileSummary) {
  const systemPrompt = await bonLoadTrianglePrompt();
  const { rawText, usage, model, costUsd } = await bonCallClaude(
    apiKey,
    systemPrompt,
    profileSummary,
    "claude triangle"
  );
  const parsed = bonExtractJson(rawText);
  if (!parsed) {
    throw new Error("Could not parse triangle JSON from Claude response");
  }
  const factors = Array.isArray(parsed.factors) ? parsed.factors : [];
  const triangle = bonComputeTriangle(factors);
  return {
    triangle,
    triangleFactors: factors,
    triangleSummary: parsed.summary || "",
    triangleModel: model,
    triangleUsage: usage,
    triangleCostUsd: costUsd,
    triangleRunAt: Date.now(),
  };
}

globalThis.bonInvestigateUserTriangle = bonInvestigateUserTriangle;
globalThis.bonResetTrianglePromptCache = bonResetTrianglePromptCache;
