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

let bonCachedPrompt = null;

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
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Reddit fetch ${res.status} for ${url}`);
  }
  return res.json();
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
  const [about, submitted, comments] = await Promise.all([
    bonFetchJson(`https://www.reddit.com/user/${safe}/about.json`),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
  ]);
  return { about, submitted, comments };
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
  return {
    postTimestamps,
    commentTimestamps,
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
  const [submitted, comments] = await Promise.all([
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
  ]);
  return bonExtractActivityData({ submitted, comments });
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
  }));

  const trimmedComments = comments.slice(0, BON_MAX_ITEMS_TO_AI).map((c) => ({
    subreddit: c.subreddit_name_prefixed || `r/${c.subreddit}`,
    body_excerpt: (c.body || "").slice(0, 500),
    score: c.score,
    created_at: new Date(c.created_utc * 1000).toISOString(),
    permalink: c.permalink,
    link_title: c.link_title || null,
  }));

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

async function bonCallClaude(apiKey, systemPrompt, profileSummary) {
  const body = {
    model: BON_CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
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
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = (json.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return {
    rawText: text,
    usage: json.usage || null,
    model: json.model || BON_CLAUDE_MODEL,
  };
}

async function bonInvestigateUser(username, apiKey, extra = {}) {
  const systemPrompt = await bonLoadAnalysisPrompt();
  // Fetch profile + BotBouncer status in parallel — BotBouncer lookup is
  // cheap and ensures the AI always sees the current status, not whatever
  // the content script happened to capture from past browsing.
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
  const { rawText, usage, model } = await bonCallClaude(
    apiKey,
    systemPrompt,
    summary
  );
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
    postsFetched: raw.submitted?.data?.children?.length || 0,
    commentsFetched: raw.comments?.data?.children?.length || 0,
    accountCreatedAt: summary.account.created_at,
    accountAgeDays: summary.account.age_days,
    activityData,
    botBouncerStatus,
    botBouncerCheckedAt,
  };
}

globalThis.bonInvestigateUser = bonInvestigateUser;
globalThis.bonFetchUserActivity = bonFetchUserActivity;
globalThis.bonResetPromptCache = bonResetPromptCache;
