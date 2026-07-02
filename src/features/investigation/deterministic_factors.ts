// Score the "hard" factors deterministically in TS rather than asking
// the LLM. These six factors are scored from numeric/boolean fields that
// already live on the ProfileSummary — the LLM was wasting tokens both
// in the prompt (long scoring tables) and the output (re-stating the
// numbers it was given). The scoring tables mirror the ones in
// `prompt.md`; if the prompt's rubric changes, this must change too.
//
// Returned factors are inserted into the canonical factor order
// alongside the LLM-scored ones in `merge_factors.ts`.

import type { Factor, ProfileSummary } from "../../types.ts";
import { AUTOGEN_WORDS } from "./autogen_words.ts";

export const DETERMINISTIC_FACTOR_KEYS = [
  "username_pattern",
  "hidden_post_history",
  "bot_bouncer_status",
  "moderator_removal_history",
  "posting_volume",
  "moderated_subreddits",
] as const;

export function scoreDeterministicFactors(summary: ProfileSummary): Factor[] {
  return [
    scoreUsernamePattern(summary),
    scoreHiddenPostHistory(summary),
    scoreBotBouncerStatus(summary),
    scoreModeratorRemovalHistory(summary),
    scorePostingVolume(summary),
    scoreModeratedSubreddits(summary),
  ];
}

// --- username_pattern ----------------------------------------------------
// Reddit's real auto-suggestions are Word[sep]Word[sep]digits with both
// words from a fixed 2,256-word inventory (see autogen_words.ts), the
// separator consistently "", "-", or "_" (never mixed, never before the
// digits alone), and 1-4 digits — plus Snoo-##### for SSO signups. A TRUE
// suggestion is what millions of legitimate signups accept, so it's a weak
// signal on its own. The IMPOSTER shape — right structure, words Reddit
// never suggests (human first/last names) — is a spam-farm signature and
// scores harder. Separator-less TitleCase pairs are also a common human
// handle style (WillyNilly1997), so they score softer than the separator
// variants. All tiers stay below the red-flag thresholds (-0.6 / 0.6):
// a username alone must never floor the verdict.

const AUTOGEN_SHAPE = /^([A-Z][a-z]+)([_-]?)([A-Z][a-z]+)\2?(\d{1,4})$/;
const SNOO_SHAPE = /^Snoo[-_]\d{4,6}$/;

// Spam-farm username generators documented by bot-swatter (BSD-3-Clause,
// https://github.com/fsvreddit/bot-swatter): digit-infix names and
// surname mutations like Margaret3U88Nelson, Patricia99kozlov,
// MichelleWilson3g33, Laura_Parker_ea.
const LLM_FARM_SHAPES = [
  /^[A-Z]?[a-z]+\d{1,2}[AEIOU]\d{1,2}[A-Z]?[a-z]+\d{0,3}$/,
  /^[A-Z][a-z]+\d[a-z]\d[A-Z][a-z]+\d{1,3}$/,
  /^[A-Z][a-z]+\d{2,4}[a-z]+$/,
  /^(?:[A-Z][a-z]+){1,2}\d[a-z][a-z0-9]{2}$/,
  /^(?:[A-Z][a-z]+_){2}[a-z]{2}$/,
];

function scoreUsernamePattern(summary: ProfileSummary): Factor {
  const name = summary.username;

  const usernameFactor = (
    score: number,
    confidence: number,
    reasoning: string
  ): Factor => ({
    key: "username_pattern",
    score,
    confidence,
    reasoning,
    evidence: [`username: ${name}`],
  });

  const shapeMatch = AUTOGEN_SHAPE.exec(name);
  if (shapeMatch || SNOO_SHAPE.test(name)) {
    const isTrueAutogen =
      SNOO_SHAPE.test(name) ||
      (shapeMatch !== null &&
        AUTOGEN_WORDS.has(shapeMatch[1]) &&
        AUTOGEN_WORDS.has(shapeMatch[3]));

    if (isTrueAutogen) {
      const totalKarma = summary.account.total_karma ?? 0;
      if (totalKarma <= 3) {
        return usernameFactor(
          -0.3,
          0.5,
          "Reddit-suggested default name on a zero-history account — LLM farms accept the default."
        );
      }

      return usernameFactor(
        -0.1,
        0.3,
        "Reddit-suggested default name; weak signal — millions of humans accept these."
      );
    }

    if (shapeMatch![2] !== "") {
      return usernameFactor(
        -0.5,
        0.55,
        "Mimics Reddit's auto-suggested shape with words Reddit never suggests — spam-farm signature."
      );
    }

    return usernameFactor(
      -0.3,
      0.45,
      "Auto-suggest-like word pair outside Reddit's inventory; also a common human handle style."
    );
  }

  if (LLM_FARM_SHAPES.some((shape) => shape.test(name))) {
    return usernameFactor(
      -0.45,
      0.5,
      "Matches a known spam-farm username generator shape."
    );
  }

  return usernameFactor(
    0.0,
    0.1,
    "Username doesn't match auto-suggested or farm shapes; no signal."
  );
}

// --- hidden_post_history -------------------------------------------------
// Karma-tiered table from prompt.md's `hidden_post_history` section, with
// the ≤6mo-and-≥10k-karma fast-accumulation modifier. The "visible
// history" / "no posts yet" branches handle non-hidden accounts.

function scoreHiddenPostHistory(summary: ProfileSummary): Factor {
  const postsFetched = summary.activity.posts_fetched;
  const commentsFetched = summary.activity.comments_fetched;
  const visibleItems = postsFetched + commentsFetched;
  const totalKarma = summary.account.total_karma ?? 0;
  const ageDays = summary.account.age_days ?? null;
  const effectivelyHidden = visibleItems <= 5 && totalKarma >= 1000;

  if (!effectivelyHidden) {
    if (visibleItems > 5) {
      return {
        key: "hidden_post_history",
        score: 0.2,
        confidence: 0.5,
        reasoning: "Visible history present; not hiding.",
        evidence: [
          `posts_fetched: ${postsFetched}, comments_fetched: ${commentsFetched}`,
        ],
      };
    }

    return {
      key: "hidden_post_history",
      score: 0.0,
      confidence: 0.15,
      reasoning: "No posts yet — can't distinguish hidden from never-posted.",
      evidence: [`total_karma: ${totalKarma}, visible items: ${visibleItems}`],
    };
  }

  // Effectively-hidden — apply the karma-tier table from prompt.md.
  let score: number;
  let confidence: number;
  let tierLabel: string;
  if (totalKarma >= 1_000_000) {
    score = 0.0;
    confidence = 0.2;
    tierLabel = "megalegacy karma (≥1M)";
  } else if (totalKarma >= 100_000) {
    score = -0.1;
    confidence = 0.3;
    tierLabel = "substantial karma (100k–1M)";
  } else if (totalKarma >= 10_000) {
    score = -0.25;
    confidence = 0.4;
    tierLabel = "significant karma (10k–100k)";
  } else if (totalKarma >= 1_000) {
    score = -0.4;
    confidence = 0.5;
    tierLabel = "moderate karma (1k–10k)";
  } else if (totalKarma >= 100) {
    score = -0.55;
    confidence = 0.55;
    tierLabel = "low karma (100–1k)";
  } else {
    score = -0.3;
    confidence = 0.35;
    tierLabel = "minimal karma (<100)";
  }

  // Fast-karma-accumulation modifier: ≤6 months old AND ≥10k karma
  let modifierNote = "";
  if (ageDays != null && ageDays <= 180 && totalKarma >= 10_000) {
    score -= 0.2;
    confidence = Math.min(1, confidence + 0.1);
    modifierNote = " (fast-karma modifier: young account + ≥10k karma)";
  }

  return {
    key: "hidden_post_history",
    score,
    confidence,
    reasoning: `Effectively hidden — ${tierLabel}${modifierNote}.`,
    evidence: [
      `total_karma: ${totalKarma}, posts_fetched: ${postsFetched}, comments_fetched: ${commentsFetched}`,
      ageDays != null ? `account age: ${ageDays} days` : "account age: unknown",
    ],
  };
}

// --- bot_bouncer_status --------------------------------------------------

function scoreBotBouncerStatus(summary: ProfileSummary): Factor {
  const bb = summary.external_signals.bot_bouncer;
  if (!bb) {
    return {
      key: "bot_bouncer_status",
      score: 0.0,
      confidence: 0.0,
      reasoning: "No Bot Bouncer data.",
      evidence: ["Bot Bouncer: no data"],
    };
  }

  const status = bb.status;
  if (status === "banned") {
    return {
      key: "bot_bouncer_status",
      score: -0.8,
      confidence: 0.8,
      reasoning: "Bot Bouncer banned; community + human review verdict.",
      evidence: ["Bot Bouncer status: banned"],
    };
  }

  if (status === "organic") {
    return {
      key: "bot_bouncer_status",
      score: 0.75,
      confidence: 0.8,
      reasoning: "Bot Bouncer organic; community + human review verdict.",
      evidence: ["Bot Bouncer status: organic"],
    };
  }

  if (status === "pending") {
    return {
      key: "bot_bouncer_status",
      score: 0.0,
      confidence: 0.15,
      reasoning: "Bot Bouncer review pending.",
      evidence: ["Bot Bouncer status: pending"],
    };
  }

  return {
    key: "bot_bouncer_status",
    score: 0.0,
    confidence: 0.0,
    reasoning: "Bot Bouncer status unrecognized.",
    evidence: [`Bot Bouncer status: ${String(status)}`],
  };
}

// --- moderator_removal_history -------------------------------------------

function scoreModeratorRemovalHistory(summary: ProfileSummary): Factor {
  const removals = summary.activity.moderator_removals;
  const visibleItems =
    summary.activity.posts_fetched + summary.activity.comments_fetched;

  if (visibleItems < 10) {
    return {
      key: "moderator_removal_history",
      score: 0.0,
      confidence: 0.15,
      reasoning: "Not enough visible history to judge removal rate.",
      evidence: [`visible items: ${visibleItems}`],
    };
  }

  const byCategory = removals?.by_category ?? {};
  const antiEvil = byCategory.anti_evil_ops ?? 0;
  const sitewide = byCategory.reddit ?? 0;
  const automod = byCategory.automod_filtered ?? 0;
  const modRemoved = byCategory.moderator ?? 0;
  const total = removals?.total ?? 0;
  const modRate = visibleItems > 0 ? modRemoved / visibleItems : 0;
  const adminRemovals = antiEvil + sitewide;
  const adminRate = visibleItems > 0 ? adminRemovals / visibleItems : 0;

  const evidenceParts: string[] = [];
  evidenceParts.push(`removals: ${total} total across ${visibleItems} items`);
  if (antiEvil > 0) {
    evidenceParts.push(`anti_evil_ops: ${antiEvil}`);
  }

  if (sitewide > 0) {
    evidenceParts.push(`reddit: ${sitewide}`);
  }

  if (automod > 0) {
    evidenceParts.push(`automod_filtered: ${automod}`);
  }

  if (modRemoved > 0) {
    evidenceParts.push(`moderator: ${modRemoved}`);
  }

  // Admin/sitewide removals are a strong signal, but 1-2 scattered hits
  // on a 600-item account are not damning — fire the strong tier only on
  // sustained admin attention.
  if (adminRemovals >= 3 || adminRate >= 0.02) {
    return {
      key: "moderator_removal_history",
      score: -0.85,
      confidence: 0.85,
      reasoning: "Sustained admin/sitewide removals.",
      evidence: evidenceParts,
    };
  }

  if (adminRemovals > 0) {
    return {
      key: "moderator_removal_history",
      score: -0.2,
      confidence: 0.4,
      reasoning: "Scattered admin/sitewide removals; modest signal.",
      evidence: evidenceParts,
    };
  }

  if (automod >= 10) {
    return {
      key: "moderator_removal_history",
      score: -0.5,
      confidence: 0.6,
      reasoning: "Heavy AutoModerator filtering across items.",
      evidence: evidenceParts,
    };
  }

  if (modRate >= 0.25) {
    return {
      key: "moderator_removal_history",
      score: -0.4,
      confidence: 0.5,
      reasoning: "High moderator-removal rate on visible items.",
      evidence: evidenceParts,
    };
  }

  if (total === 0 && visibleItems >= 30) {
    return {
      key: "moderator_removal_history",
      score: 0.3,
      confidence: 0.5,
      reasoning: "Zero removals across substantial visible history.",
      evidence: evidenceParts,
    };
  }

  return {
    key: "moderator_removal_history",
    score: 0.0,
    confidence: 0.25,
    reasoning: "Scattered or no removals; no strong signal.",
    evidence: evidenceParts,
  };
}

// --- posting_volume ------------------------------------------------------

function scorePostingVolume(summary: ProfileSummary): Factor {
  const rate = summary.activity.posting_rate;
  if (!rate) {
    return {
      key: "posting_volume",
      score: 0.0,
      confidence: 0.15,
      reasoning: "Not enough timestamps to measure rate.",
      evidence: ["posting_rate: null"],
    };
  }

  const perDay = rate.visible_items_per_day;
  const capped = rate.sample_capped;
  const window = rate.visible_window_days;

  let score: number;
  let confidence: number;
  let band: string;
  if (perDay >= 100) {
    score = -0.85;
    confidence = 0.85;
    band = "≥100/day";
  } else if (perDay >= 50) {
    score = -0.6;
    confidence = 0.7;
    band = "50–100/day";
  } else if (perDay >= 25) {
    score = -0.35;
    confidence = 0.5;
    band = "25–50/day";
  } else if (perDay >= 10) {
    score = -0.1;
    confidence = 0.4;
    band = "10–25/day";
  } else if (perDay >= 2) {
    score = 0.3;
    confidence = 0.5;
    band = "<10/day";
  } else {
    score = 0.5;
    confidence = 0.6;
    band = "<2/day";
  }

  // sample_capped means the rate is a lower bound — nudge bot-ward.
  let cappedNote = "";
  if (capped && score < 0) {
    score = Math.max(-1, score - 0.1);
    confidence = Math.min(1, confidence + 0.05);
    cappedNote = " (sample capped — rate is a lower bound)";
  }

  return {
    key: "posting_volume",
    score,
    confidence,
    reasoning: `Posting rate in ${band} band${cappedNote}.`,
    evidence: [
      `posting_rate: ${perDay} items/day over ${window} days${capped ? " (sample capped)" : ""}`,
    ],
  };
}

// --- moderated_subreddits ------------------------------------------------

function scoreModeratedSubreddits(summary: ProfileSummary): Factor {
  const mod = summary.activity.moderated_subreddits;
  if (!mod) {
    return {
      key: "moderated_subreddits",
      score: 0.0,
      confidence: 0.0,
      reasoning: "No moderation data available.",
      evidence: ["moderated_subreddits: missing"],
    };
  }

  const count = mod.count;
  const list = mod.list ?? [];
  if (count === 0) {
    return {
      key: "moderated_subreddits",
      score: 0.0,
      confidence: 0.15,
      reasoning: "No moderation roles — no signal.",
      evidence: ["moderated count: 0"],
    };
  }

  const smallSubs = list.filter(
    (m) => typeof m.subscribers === "number" && m.subscribers <= 1_000
  );
  const largeSubs = list.filter(
    (m) => typeof m.subscribers === "number" && m.subscribers >= 100_000
  );

  const smallPreview = list
    .slice()
    .sort(
      (a, b) =>
        (typeof a.subscribers === "number" ? a.subscribers : Infinity) -
        (typeof b.subscribers === "number" ? b.subscribers : Infinity)
    )
    .slice(0, 3)
    .map(
      (m) =>
        `${m.sub}${typeof m.subscribers === "number" ? ` (${m.subscribers})` : ""}`
    )
    .join(", ");

  if (count >= 5 && smallSubs.length >= Math.ceil(count / 2)) {
    return {
      key: "moderated_subreddits",
      score: -0.7,
      confidence: 0.7,
      reasoning:
        "Moderates ≥5 subs mostly with ≤1k subscribers — karma-farm pattern.",
      evidence: [`mod count: ${count}; smallest: ${smallPreview}`],
    };
  }

  if (count >= 10) {
    return {
      key: "moderated_subreddits",
      score: -0.5,
      confidence: 0.6,
      reasoning: "Moderates many subs with no obvious thematic link.",
      evidence: [`mod count: ${count}; smallest: ${smallPreview}`],
    };
  }

  if (count >= 1 && count <= 2 && largeSubs.length >= 1) {
    return {
      key: "moderated_subreddits",
      score: 0.5,
      confidence: 0.6,
      reasoning: "Vetted volunteer mod of mainstream large sub(s).",
      evidence: [
        `mod count: ${count}; large: ${largeSubs.map((m) => m.sub).join(", ")}`,
      ],
    };
  }

  return {
    key: "moderated_subreddits",
    score: 0.0,
    confidence: 0.3,
    reasoning: "Niche moderation — informational only.",
    evidence: [`mod count: ${count}; smallest: ${smallPreview}`],
  };
}
