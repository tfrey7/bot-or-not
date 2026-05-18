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

export interface Investigation {
  status: InvestigationStatus;
  startedAt?: number | null;
  runAt?: number;
  durationMs?: number | null;
  error?: string | null;
  verdict?: Verdict;
  confidence?: number;
  botProbability?: number;
  factors?: Factor[];
  persona?: Persona | null;
  summary?: string;
  model?: string;
  usage?: ClaudeUsage | null;
  webSearchCount?: number;
  costUsd?: number | null;
  postsFetched?: number;
  commentsFetched?: number;
  accountCreatedAt?: string | null;
  accountAgeDays?: number | null;
  runs?: RunSnapshot[];
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

export interface Report {
  count: number;
  lastReportedAt: number;
  history: HistoryEntry[];
  userStatus: UserStatus;
  userStatusCheckedAt: number;
  createdAt: number | null;
  botBouncerStatus?: BotBouncerStatus;
  botBouncerCheckedAt?: number;
  investigation: Investigation | null;
  activityData?: ActivityData | null;
}

// Profile summary handed to Claude as JSON. Loose shape — the prompt does
// the actual schema enforcement, this just types the assembly call sites.
export interface ProfileSummary {
  username: string;
  account: {
    name: string;
    created_at: string | null;
    age_days: number | null;
    total_karma: number | null;
    link_karma: number | null;
    comment_karma: number | null;
    is_employee: boolean;
    verified: boolean;
    has_verified_email: boolean;
  };
  activity: {
    posts_fetched: number;
    comments_fetched: number;
    top_subreddits: Array<{ sub: string; count: number }>;
    moderator_removals: {
      total: number;
      by_category: Record<string, number>;
    };
    posting_rate: {
      visible_window_days: number;
      visible_items_per_day: number;
      sample_size: number;
      sample_capped: boolean;
    } | null;
    moderated_subreddits: {
      count: number;
      list: Array<{
        sub: string;
        subscribers: number | null;
        type: string | null;
        over_18: boolean;
      }>;
    };
  };
  external_signals: {
    bot_bouncer: {
      status: BotBouncerStatus;
      checked_at: string | null;
    } | null;
  };
  recent_posts: Array<Record<string, unknown>>;
  recent_comments: Array<Record<string, unknown>>;
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
