// Shared domain types for Bot or Not. Mirror the storage shape documented
// in CLAUDE.md — Report records, Investigation results, Factor scores,
// Persona output. Cross-feature contracts go here; feature-internal shapes
// stay alongside their feature.

export type Verdict =
  | "bot"
  | "likely-bot"
  | "uncertain"
  | "likely-human"
  | "human";

export type InvestigationStatus = "running" | "done" | "error";

export type ArchetypeKey =
  | "stan"
  | "farmer"
  | "teen"
  | "thirst"
  | "crank"
  | "hustler"
  | "doomer";

export type PersonaLabel = ArchetypeKey | "bot" | "normal";

export type UserStatus = "active" | "suspended" | null;

export type BotBouncerStatus = "banned" | "pending" | "organic" | null;

export type FactorLeaning =
  | "bot"
  | "likely-bot"
  | "neutral"
  | "likely-human"
  | "human";

export interface Factor {
  key: string;
  score: number;
  confidence: number;
  reasoning?: string;
  evidence?: string | string[];
}

export interface Persona {
  label: PersonaLabel;
  reasoning: string;
  archetypes: Record<ArchetypeKey, number> | null;
}

// Anthropic Messages API usage block — only the fields we read.
export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface RunSnapshot {
  runAt: number;
  durationMs: number | null;
  status: InvestigationStatus;
  verdict: Verdict | null;
  confidence: number | null;
  botProbability: number | null;
  model: string | null;
  usage: ClaudeUsage | null;
  costUsd: number | null;
  webSearchCount: number;
  postsFetched: number;
  commentsFetched: number;
  error: string | null;
}

// Investigation is stored as one struct that mutates through "running" →
// "done"/"error". bonNormalizeReport canonicalizes from unknown JSON and
// fills in defaults so every key is always present. Consumers gate on
// `status` to know which result fields are populated:
//   running → verdict/factors/etc. are null/empty; startedAt is set
//   done    → all result fields populated
//   error   → `error` is set; result fields may be null/empty
// Result fields use `null` (not omission) for "not yet known."
export interface Investigation {
  status: InvestigationStatus;
  startedAt: number | null;
  runAt: number | null;
  durationMs: number | null;
  error: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  botProbability: number | null;
  factors: Factor[];
  persona: Persona | null;
  summary: string;
  model: string | null;
  usage: ClaudeUsage | null;
  webSearchCount: number;
  costUsd: number | null;
  postsFetched: number;
  commentsFetched: number;
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
  runs: RunSnapshot[];
}

// History entry from a single report click. `at` is the unix-ms timestamp.
// Other fields come from whatever the reporting feature scraped at click
// time — keep this loose so legacy records still parse.
export interface HistoryEntry {
  at: number;
  permalink?: string;
  subreddit?: string;
  postTitle?: string;
  kind?: string;
  status?: string | null;
  statusCheckedAt?: number;
  [k: string]: unknown;
}

export interface ActivityData {
  postTimestamps: number[];
  commentTimestamps: number[];
  subredditCounts: Record<string, number>;
  scriptSignals: Record<string, number>;
  languageSignals: Record<string, number>;
  moderatedSubs: string[];
  corpusChars: number;
  postsLimited: boolean;
  commentsLimited: boolean;
  earliestPostAt: number | null;
  earliestCommentAt: number | null;
  fetchLimit: number;
  fetchedAt: number;
}

// Operator-collected dossier entry. Captured automatically when a report is
// filed (provenance: "auto") and manually via the in-page "Add context" button
// (provenance: "manual"). Trimmed to ~1KB per item so dossiers can grow without
// blowing the investigation prompt budget.
//
// Every field is always present — bonFetchContextItem sets all of them, using
// `null` for absent data. No two-way optionality.
export interface ContextItem {
  permalink: string;
  kind: "post" | "comment";
  subreddit: string | null;
  author: string;
  title: string | null;
  body: string | null;
  score: number | null;
  createdAt: string | null;
  addedAt: number;
  provenance: "auto" | "manual";
}

// Canonical Report shape produced by bonNormalizeReport. Every field is always
// present; `null` (or 0 for timestamps) means "no signal." No two-way optionality.
export interface Report {
  count: number;
  lastReportedAt: number;
  history: HistoryEntry[];
  userStatus: UserStatus;
  userStatusCheckedAt: number;
  createdAt: number | null;
  botBouncerStatus: BotBouncerStatus;
  botBouncerCheckedAt: number;
  investigation: Investigation | null;
  activityData: ActivityData | null;
  contextItems: ContextItem[];
}

// Profile summary handed to Claude as JSON. The prompt does the actual schema
// enforcement, but the assembly call sites in summarize.ts produce these named
// shapes so consumers (and prompt authors) can see what's guaranteed.

export interface AccountSummary {
  name: string;
  created_at: string | null;
  age_days: number | null;
  total_karma: number | null;
  link_karma: number | null;
  comment_karma: number | null;
  is_employee: boolean;
  verified: boolean;
  has_verified_email: boolean;
}

export interface TopSubreddit {
  sub: string;
  count: number;
}

export interface ModeratorRemovals {
  total: number;
  by_category: Record<string, number>;
}

export interface PostingRate {
  visible_window_days: number;
  visible_items_per_day: number;
  sample_size: number;
  sample_capped: boolean;
}

export interface ModeratedSubreddit {
  sub: string;
  subscribers: number | null;
  type: string | null;
  over_18: boolean;
}

export interface ModeratedSubreddits {
  count: number;
  list: ModeratedSubreddit[];
}

export interface BotBouncerSignal {
  status: Exclude<BotBouncerStatus, null>;
  checked_at: string | null;
}

export interface SummaryPost {
  subreddit: string;
  title: string | null;
  selftext_excerpt: string;
  score: number | null;
  num_comments: number | null;
  created_at: string | null;
  url: string | null;
  permalink: string | null;
  is_self: boolean;
  over_18: boolean;
  removed_by_category: string | null;
}

export interface SummaryComment {
  subreddit: string;
  body_excerpt: string;
  score: number | null;
  created_at: string | null;
  permalink: string | null;
  link_title: string | null;
  removed_by_category: string | null;
}

export interface OperatorContextSummary {
  kind: "post" | "comment";
  subreddit: string | null;
  title: string | null;
  body: string | null;
  score: number | null;
  created_at: string | null;
  permalink: string;
  added_at: string;
  provenance: "auto" | "manual";
}

export interface ProfileSummary {
  username: string;
  account: AccountSummary;
  activity: {
    posts_fetched: number;
    comments_fetched: number;
    top_subreddits: TopSubreddit[];
    moderator_removals: ModeratorRemovals;
    posting_rate: PostingRate | null;
    moderated_subreddits: ModeratedSubreddits;
  };
  external_signals: {
    bot_bouncer: BotBouncerSignal | null;
  };
  recent_posts: SummaryPost[];
  recent_comments: SummaryComment[];
  operator_collected_context?: OperatorContextSummary[];
}

// Raw Reddit JSON envelopes we look into. Field set is intentionally
// open — we only declare the few keys our code touches.
export interface RedditAboutEnvelope {
  data?: {
    name?: string;
    created_utc?: number;
    total_karma?: number;
    link_karma?: number;
    comment_karma?: number;
    is_employee?: boolean;
    verified?: boolean;
    has_verified_email?: boolean;
  };
}

export interface RedditListing<T = Record<string, unknown>> {
  data?: {
    children?: Array<{ data?: T }>;
  };
}

export interface RedditModeratedList {
  data?: Array<{
    sr?: string;
    sr_display_name_prefixed?: string;
    display_name?: string;
    subscribers?: number;
    subreddit_type?: string;
    over_18?: boolean;
    url?: string;
  }>;
}

export interface RedditProfile {
  about: RedditAboutEnvelope;
  submitted: RedditListing;
  comments: RedditListing;
  moderated: RedditModeratedList | null;
}

export interface RedditActivityFetch {
  submitted: RedditListing;
  comments: RedditListing;
  moderated: RedditModeratedList | null;
}
