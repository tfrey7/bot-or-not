// Investigation pipeline: Reddit fetch -> Claude API -> structured verdict.
// Loaded before background.js; functions are attached to globalThis so the
// background message handlers can call them.

const BON_CLAUDE_MODEL = "claude-sonnet-4-6";
const BON_CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const BON_REDDIT_FETCH_LIMIT = 100;
const BON_MAX_ITEMS_TO_AI = 60; // per kind (posts + comments)
// Hard ceiling on the Claude call. Sonnet 4.6 on a 14k-token prompt typically
// returns in 40-90s; anything past this is a hung connection, not a slow one.
const BON_CLAUDE_TIMEOUT_MS = 4 * 60 * 1000;

// USD per million tokens. Verify against current Anthropic pricing — these
// drift. Web search is billed per request, not per token.
const BON_MODEL_PRICING = {
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
  },
};
const BON_WEB_SEARCH_USD_PER_REQUEST = 0.01;

// Look up a pricing row by the model id the API echoed back. The API often
// returns a dated suffix (e.g. "claude-sonnet-4-6-20251022"); match by prefix.
function bonLookupPricing(model) {
  if (!model) return null;
  if (BON_MODEL_PRICING[model]) return BON_MODEL_PRICING[model];
  for (const key of Object.keys(BON_MODEL_PRICING)) {
    if (model.startsWith(key)) return BON_MODEL_PRICING[key];
  }
  return null;
}

// Compute USD cost for one Claude call. Returns null if the model is unknown
// so callers can distinguish "free" from "unpriced".
function bonEstimateCostUsd(usage, model, webSearchCount = 0) {
  const p = bonLookupPricing(model);
  if (!p || !usage) return null;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens;
  // Prefer the split if present; otherwise treat all cache creation as 5m.
  const w5 = write5m != null ? write5m : cacheCreate;
  const w1 = write1h != null ? write1h : 0;
  const usd =
    (inTok * p.input +
      outTok * p.output +
      cacheRead * p.cacheRead +
      w5 * p.cacheWrite5m +
      w1 * p.cacheWrite1h) /
      1_000_000 +
    (webSearchCount || 0) * BON_WEB_SEARCH_USD_PER_REQUEST;
  return usd;
}

let bonCachedPrompt = null;

function bonShortUrl(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function bonTimed(label, fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`[Bot or Not] timing: ${label} ${ms}ms`);
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    console.log(`[Bot or Not] timing: ${label} ${ms}ms (failed)`);
    throw err;
  }
}

async function bonLoadAnalysisPrompt() {
  if (bonCachedPrompt) return bonCachedPrompt;
  const url = browser.runtime.getURL("src/bot_analysis.md");
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to load bot_analysis.md (${res.status})`);
  bonCachedPrompt = await res.text();
  return bonCachedPrompt;
}

function bonResetPromptCache() {
  bonCachedPrompt = null;
}

async function bonFetchJson(url) {
  return bonTimed(`fetch ${bonShortUrl(url)}`, async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`Reddit fetch ${res.status} for ${url}`);
    }
    return res.json();
  });
}

// Active lookup of the user's BotBouncer verdict so the AI sees it even if
// the user hasn't browsed an r/BotBouncer post recently (which is what
// content_script's passive detector relies on).
async function bonFetchBotBouncerStatus(username) {
  const q = encodeURIComponent(`Overview for ${username}`);
  const url = `https://www.reddit.com/r/BotBouncer/search.json?q=${q}&restrict_sr=true&sort=new&limit=10&raw_json=1`;
  try {
    const json = await bonFetchJson(url);
    const posts = (json.data?.children || [])
      .map((c) => c.data)
      .filter(Boolean);
    const target = `overview for ${username}`.toLowerCase();
    const match = posts.find(
      (p) => (p.title || "").toLowerCase().trim() === target
    );
    if (!match) return null;
    const flair = (match.link_flair_text || "").toLowerCase().trim();
    if (flair === "banned" || flair === "pending" || flair === "organic") {
      return flair;
    }
    return null;
  } catch (err) {
    console.error("[Bot or Not] BotBouncer lookup failed", err);
    return null;
  }
}

async function bonFetchRedditProfile(username) {
  const safe = encodeURIComponent(username);
  const [about, submitted, comments, moderated] = await Promise.all([
    bonFetchJson(`https://www.reddit.com/user/${safe}/about.json`),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/moderated_subreddits.json?raw_json=1`
    ).catch(() => null),
  ]);
  return { about, submitted, comments, moderated };
}

function bonExtractActivityData(raw) {
  const posts = (raw.submitted?.data?.children || [])
    .map((c) => c.data)
    .filter(Boolean);
  const comments = (raw.comments?.data?.children || [])
    .map((c) => c.data)
    .filter(Boolean);
  const postTimestamps = posts
    .map((p) => (p.created_utc ? p.created_utc * 1000 : null))
    .filter((t) => typeof t === "number");
  const commentTimestamps = comments
    .map((c) => (c.created_utc ? c.created_utc * 1000 : null))
    .filter((t) => typeof t === "number");
  const subredditCounts = {};
  for (const item of [...posts, ...comments]) {
    const sub = (
      item.subreddit ||
      (item.subreddit_name_prefixed || "").replace(/^r\//i, "")
    )
      .toString()
      .toLowerCase();
    if (!sub) continue;
    subredditCounts[sub] = (subredditCounts[sub] || 0) + 1;
  }
  // Concatenate all visible user-authored text and scan for region signals
  // (non-Latin scripts, dialect/transliteration markers). The scanner lives
  // in regions.js so the script/marker tables stay in one place.
  const corpus = [
    ...posts.map((p) => `${p.title || ""}\n${p.selftext || ""}`),
    ...comments.map((c) => c.body || ""),
  ].join("\n");
  const scanned =
    typeof bonScanTextSignals === "function"
      ? bonScanTextSignals(corpus)
      : { scripts: {}, languages: {} };
  // moderated_subreddits.json: { "data": [{ "sr": "name", ... }, ...] } when
  // the user has the "show moderated subs publicly" setting on; otherwise it
  // 403s and bonFetchRedditProfile catches → null. Either case is fine.
  const moderatedSubs = Array.isArray(raw.moderated?.data)
    ? raw.moderated.data
        .map((m) => m.sr || m.display_name || null)
        .filter(Boolean)
    : [];
  return {
    postTimestamps,
    commentTimestamps,
    subredditCounts,
    scriptSignals: scanned.scripts,
    languageSignals: scanned.languages,
    moderatedSubs,
    corpusChars: corpus.length,
    postsLimited: posts.length >= BON_REDDIT_FETCH_LIMIT,
    commentsLimited: comments.length >= BON_REDDIT_FETCH_LIMIT,
    earliestPostAt: postTimestamps.length ? Math.min(...postTimestamps) : null,
    earliestCommentAt: commentTimestamps.length
      ? Math.min(...commentTimestamps)
      : null,
    fetchLimit: BON_REDDIT_FETCH_LIMIT,
    fetchedAt: Date.now(),
  };
}

async function bonFetchUserActivity(username) {
  const safe = encodeURIComponent(username);
  const [submitted, comments, moderated] = await Promise.all([
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/moderated_subreddits.json?raw_json=1`
    ).catch(() => null),
  ]);
  return bonExtractActivityData({ submitted, comments, moderated });
}

function bonSummarizeProfile(username, raw, extra = {}) {
  const aboutData = raw.about?.data || {};
  const posts = (raw.submitted?.data?.children || [])
    .map((c) => c.data)
    .filter(Boolean);
  const comments = (raw.comments?.data?.children || [])
    .map((c) => c.data)
    .filter(Boolean);

  const createdUtc = aboutData.created_utc
    ? aboutData.created_utc * 1000
    : null;
  const ageDays = createdUtc
    ? Math.floor((Date.now() - createdUtc) / 86_400_000)
    : null;

  const trimmedPosts = posts.slice(0, BON_MAX_ITEMS_TO_AI).map((p) => ({
    subreddit: p.subreddit_name_prefixed || `r/${p.subreddit}`,
    title: p.title,
    selftext_excerpt: (p.selftext || "").slice(0, 400),
    score: p.score,
    num_comments: p.num_comments,
    created_at: new Date(p.created_utc * 1000).toISOString(),
    url: p.url_overridden_by_dest || null,
    permalink: p.permalink,
    is_self: p.is_self,
    over_18: p.over_18,
    removed_by_category: p.removed_by_category || null,
  }));

  const trimmedComments = comments.slice(0, BON_MAX_ITEMS_TO_AI).map((c) => ({
    subreddit: c.subreddit_name_prefixed || `r/${c.subreddit}`,
    body_excerpt: (c.body || "").slice(0, 500),
    score: c.score,
    created_at: new Date(c.created_utc * 1000).toISOString(),
    permalink: c.permalink,
    link_title: c.link_title || null,
    removed_by_category: c.removed_by_category || null,
  }));

  const removalCounts = { total: 0, by_category: {} };
  for (const item of [...posts, ...comments]) {
    const cat = item.removed_by_category;
    if (!cat) continue;
    removalCounts.total++;
    removalCounts.by_category[cat] = (removalCounts.by_category[cat] || 0) + 1;
  }

  // Posting rate over the visible window. The fetched sample is capped at
  // ~100 posts + 100 comments; the window between the oldest and newest item
  // tells us how fast they accumulated. A heavy farmer can hit 50+/day
  // sustained — well above what a normal human (even a Stan) does.
  const allTimestamps = [...posts, ...comments]
    .map((it) => (it.created_utc ? it.created_utc * 1000 : null))
    .filter((t) => typeof t === "number");
  let postingRate = null;
  if (allTimestamps.length >= 2) {
    const newest = Math.max(...allTimestamps);
    const oldest = Math.min(...allTimestamps);
    const windowMs = Math.max(newest - oldest, 1);
    const windowDays = windowMs / 86_400_000;
    postingRate = {
      visible_window_days: Number(windowDays.toFixed(2)),
      visible_items_per_day: Number(
        (allTimestamps.length / Math.max(windowDays, 1 / 24)).toFixed(2)
      ),
      sample_size: allTimestamps.length,
      sample_capped:
        posts.length >= BON_REDDIT_FETCH_LIMIT ||
        comments.length >= BON_REDDIT_FETCH_LIMIT,
    };
  }

  // Moderated subreddits. Reddit returns {kind: "ModeratedList", data: [...]}
  // where each entry has sr_display_name_prefixed, subscribers, subreddit_type,
  // over_18, etc. A 403 / null means the user hides their mod list (rare) or
  // has no mod roles — treat both as "no signal" downstream.
  const modRaw = Array.isArray(raw.moderated?.data) ? raw.moderated.data : [];
  const moderatedList = modRaw
    .map((m) => ({
      sub:
        m.sr_display_name_prefixed ||
        (m.sr ? `r/${m.sr}` : null) ||
        (m.display_name ? `r/${m.display_name}` : null) ||
        m.url ||
        null,
      subscribers: typeof m.subscribers === "number" ? m.subscribers : null,
      type: m.subreddit_type || null,
      over_18: !!m.over_18,
    }))
    .filter((m) => m.sub);
  const moderatedSummary = {
    count: moderatedList.length,
    list: moderatedList,
  };

  const subredditCounts = {};
  for (const p of posts) {
    const k = p.subreddit_name_prefixed || `r/${p.subreddit}`;
    subredditCounts[k] = (subredditCounts[k] || 0) + 1;
  }
  for (const c of comments) {
    const k = c.subreddit_name_prefixed || `r/${c.subreddit}`;
    subredditCounts[k] = (subredditCounts[k] || 0) + 1;
  }
  const topSubreddits = Object.entries(subredditCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([sub, count]) => ({ sub, count }));

  return {
    username,
    account: {
      name: aboutData.name || username,
      created_at: createdUtc ? new Date(createdUtc).toISOString() : null,
      age_days: ageDays,
      total_karma: aboutData.total_karma ?? null,
      link_karma: aboutData.link_karma ?? null,
      comment_karma: aboutData.comment_karma ?? null,
      is_employee: !!aboutData.is_employee,
      verified: !!aboutData.verified,
      has_verified_email: !!aboutData.has_verified_email,
    },
    activity: {
      posts_fetched: posts.length,
      comments_fetched: comments.length,
      top_subreddits: topSubreddits,
      moderator_removals: removalCounts,
      posting_rate: postingRate,
      moderated_subreddits: moderatedSummary,
    },
    external_signals: {
      bot_bouncer: extra.botBouncerStatus
        ? {
            status: extra.botBouncerStatus,
            checked_at: extra.botBouncerCheckedAt
              ? new Date(extra.botBouncerCheckedAt).toISOString()
              : null,
          }
        : null,
    },
    recent_posts: trimmedPosts,
    recent_comments: trimmedComments,
  };
}

function bonExtractJson(text) {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json or ``` fences if present
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  // Find the first {...} block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    console.error("[Bot or Not] verdict JSON parse failed", err, candidate);
    return null;
  }
}

async function bonCallClaude(
  apiKey,
  systemPrompt,
  profileSummary,
  label = "claude",
  options = {}
) {
  const t0 = performance.now();
  const webSearchOn = !!options.webSearch;
  const body = {
    model: BON_CLAUDE_MODEL,
    // Bumped from 4096 — with web_search the response can include intermediate
    // text blocks (Claude narrating before/after the search) on top of the
    // final JSON verdict. Sonnet 4.6 supports much higher; 8192 is safe
    // headroom without becoming a runaway expense.
    max_tokens: webSearchOn ? 8192 : 4096,
    // Mark the system prompt for ephemeral (5-min) caching. The 1D and triangle
    // prompts are byte-identical across investigations, so back-to-back calls
    // within ~5 min hit the cache at ~10% of the input rate.
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
    // Server-side web search — Anthropic runs the search and feeds results
    // back to the model transparently. Capped at 1 use to keep cost
    // predictable (~$0.01/investigation + result tokens).
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

  let res;
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
    if (err?.name === "AbortError") {
      throw new Error(
        `Claude API timed out after ${BON_CLAUDE_TIMEOUT_MS / 1000}s`
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
  const json = await res.json();
  const text = (json.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  // Count actual web_search invocations so the UI can show whether a search
  // happened (the model may decline to search if it judges the data sufficient).
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

// Fetch + summarize the account once. Shared between the 1D analyzer and the
// triangle analyzer so both prompts work from the same input (one Reddit fetch
// per investigation, not two).
async function bonGatherProfile(username, extra = {}) {
  const [raw, freshBotBouncerStatus] = await Promise.all([
    bonFetchRedditProfile(username),
    bonFetchBotBouncerStatus(username),
  ]);
  const botBouncerStatus =
    freshBotBouncerStatus || extra.botBouncerStatus || null;
  const botBouncerCheckedAt = freshBotBouncerStatus
    ? Date.now()
    : extra.botBouncerCheckedAt || null;
  const summary = bonSummarizeProfile(username, raw, {
    botBouncerStatus,
    botBouncerCheckedAt,
  });
  const activityData = bonExtractActivityData(raw);
  return {
    summary,
    activityData,
    raw,
    botBouncerStatus,
    botBouncerCheckedAt,
  };
}

// Runs the existing 1D bot↔human analysis against an already-built summary.
async function bonRunOneDAnalysis(apiKey, profileSummary) {
  const systemPrompt = await bonLoadAnalysisPrompt();
  const { rawText, usage, model, webSearchCount, costUsd } =
    await bonCallClaude(apiKey, systemPrompt, profileSummary, "claude 1D", {
      webSearch: true,
    });
  const verdict = bonExtractJson(rawText);
  if (!verdict) {
    throw new Error("Could not parse verdict JSON from Claude response");
  }
  const factors = Array.isArray(verdict.factors) ? verdict.factors : [];
  const derived = bonComputeVerdict(factors);
  return {
    verdict: derived.verdict,
    confidence: derived.confidence,
    botProbability: derived.botProbability,
    summary: verdict.summary || "",
    factors,
    runAt: Date.now(),
    model,
    usage,
    webSearchCount: webSearchCount || 0,
    costUsd,
  };
}

// Old single-call entry point. Kept so anything still calling it keeps working;
// background.js now uses bonGatherProfile + bonRunOneDAnalysis + the triangle
// analyzer in parallel instead.
async function bonInvestigateUser(username, apiKey, extra = {}) {
  const inputs = await bonGatherProfile(username, extra);
  const oneD = await bonRunOneDAnalysis(apiKey, inputs.summary);
  return {
    ...oneD,
    postsFetched: inputs.raw.submitted?.data?.children?.length || 0,
    commentsFetched: inputs.raw.comments?.data?.children?.length || 0,
    accountCreatedAt: inputs.summary.account.created_at,
    accountAgeDays: inputs.summary.account.age_days,
    activityData: inputs.activityData,
    botBouncerStatus: inputs.botBouncerStatus,
    botBouncerCheckedAt: inputs.botBouncerCheckedAt,
  };
}

globalThis.bonGatherProfile = bonGatherProfile;
globalThis.bonRunOneDAnalysis = bonRunOneDAnalysis;
globalThis.bonInvestigateUser = bonInvestigateUser;
globalThis.bonFetchUserActivity = bonFetchUserActivity;
globalThis.bonResetPromptCache = bonResetPromptCache;
globalThis.bonCallClaude = bonCallClaude;
globalThis.bonExtractJson = bonExtractJson;
globalThis.bonEstimateCostUsd = bonEstimateCostUsd;
