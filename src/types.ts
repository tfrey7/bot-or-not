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

export type InvestigationStatus = "queued" | "running" | "done" | "error";

export type ArchetypeKey =
  | "stan"
  | "farmer"
  | "cam_model"
  | "zealot"
  | "hustler"
  | "doomer";

// Age band Claude infers for the account operator. Lives parallel to region
// — same evidentiary model (avatar, voice, sub mix, self-references). `null`
// when the data genuinely doesn't say. Stored alongside `region` on the
// investigation result so the UI can surface it as a chip independent of the
// persona radar.
export type AgeBand = "teen" | "young-adult" | "adult" | "older";

export interface Demographics {
  age_band: AgeBand | null;
  confidence: number;
  reasoning: string;
}

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
  reasoning: string;
  evidence: string | string[];
}

export interface Persona {
  label: PersonaLabel;
  reasoning: string;
  archetypes: Record<ArchetypeKey, number> | null;
}

// AI-inferred region. `code` is a 2-letter ISO key from BON_REGION_INFO or
// null when the model can't tell. Lives alongside the deterministic region
// pipeline — the AI pick takes precedence when present and the deterministic
// signals become supporting context / contradiction detection.
export interface RegionInferenceAi {
  code: string | null;
  confidence: number;
  reasoning: string;
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

export type RedditEndpoint =
  | "about"
  | "submitted"
  | "comments"
  | "moderated"
  | "botbouncer";

export interface RedditFetchMetric {
  endpoint: RedditEndpoint;
  durationMs: number;
  status: "ok" | "error";
  itemCount: number | null;
  httpStatus: number | null;
}

export interface RedditMetrics {
  fetches: RedditFetchMetric[];
  totalDurationMs: number;
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
  postsFetched: number;
  commentsFetched: number;
  redditMetrics: RedditMetrics | null;
  error: string | null;
}

// Results of a completed investigation run. Populated only when status is
// "done" — discriminating Investigation on `status` lets TS narrow to the
// done variant and access `results` without per-field null checks.
export interface InvestigationResults {
  runAt: number;
  durationMs: number;
  verdict: Verdict;
  confidence: number;
  botProbability: number;
  factors: Factor[];
  persona: Persona | null;
  region: RegionInferenceAi | null;
  demographics: Demographics | null;
  summary: string;
  model: string;
  usage: ClaudeUsage | null;
  costUsd: number | null;
  postsFetched: number;
  commentsFetched: number;
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
}

// Lifecycle fields shared across every Investigation variant. Track the
// *current* attempt's queue/run timing — historical runs live in `runs[]`.
interface InvestigationLifecycle {
  queuedAt: number | null;
  startedAt: number | null;
  durationMs: number | null;
  error: string | null;

  // Count of runs we've started for this investigation (1 = first try in
  // progress, etc.). Bumped when the run transitions to "running". Caps
  // out at BON_INVESTIGATION_MAX_ATTEMPTS — failures past that stay as
  // "error" instead of getting re-queued.
  attempts: number;
  runs: RunSnapshot[];

  // Fetch metrics from the most recent Reddit attempt (or null if no
  // fetch was attempted). Lives at the lifecycle level because it can be
  // populated even on "error" transitions when the Reddit fetch failed.
  redditMetrics: RedditMetrics | null;
}

// Investigation is stored as one struct that mutates through
// "queued" → "running" → "done"/"error". bonNormalizeReport canonicalizes
// from unknown JSON and fills in defaults so every key is always present.
// `status` discriminates the union — narrowing on it gives TypeScript
// access to the populated `results` for "done", and forces consumers to
// gate on status before touching result fields. Result fields are cleared
// to null when transitioning out of "done"; historical results live in
// `runs[]`.
export type Investigation =
  | (InvestigationLifecycle & { status: "queued"; results: null })
  | (InvestigationLifecycle & { status: "running"; results: null })
  | (InvestigationLifecycle & { status: "done"; results: InvestigationResults })
  | (InvestigationLifecycle & { status: "error"; results: null });

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

  // Parallel to postTimestamps / commentTimestamps — lowercase subreddit name
  // each item appeared in, or "" if Reddit didn't surface one. Drives the
  // per-subreddit overlaid chart. Older stored snapshots predate this field
  // and will be missing it; renderers must tolerate undefined.
  postSubreddits?: string[];
  commentSubreddits?: string[];
  subredditCounts: Record<string, number>;
  scriptSignals: Record<string, number>;
  languageSignals: Record<string, number>;
  languageSamples?: Record<string, string[]>;
  moderatedSubs: string[];
  corpusChars: number;
  postsLimited: boolean;
  commentsLimited: boolean;
  earliestPostAt: number | null;
  earliestCommentAt: number | null;
  fetchLimit: number;
  fetchedAt: number;
}

// User's own take on this account, recorded independently of the AI's
// investigation. `ratings` is a set of hand-picked persona labels (empty
// array = no call yet) — multi-pick because some accounts read as more
// than one archetype at once. `note` is a free-form scratchpad. One record
// per username — editing overwrites, no history. `updatedAt` is unix ms;
// 0 means never edited but exists because storage migration created a
// placeholder.
export interface UserNotes {
  ratings: PersonaLabel[];
  note: string;
  updatedAt: number;
}

// User-initiated Google SERP harvest for a username. Captured client-side by
// the google-harvest content script (which runs on any Google search of the
// form "<name> site:reddit.com", including page 2/3/… of the same search),
// then merged into the matching Report record. The investigation pipeline
// reads it and hands it to Claude as additional context — useful when a user
// has hidden their Reddit profile but Google still indexes their posts.
//
// Merge semantics: posts are unioned by canonical URL. Each post carries
// firstSeenAt (immutable, set on first capture) and lastSeenAt (refreshed
// every time Google surfaces that URL again). A post that stops appearing
// keeps its old lastSeenAt — falling out of Google is itself a signal.
export type GoogleHarvestPostKind =
  | "profile-root"
  | "profile-post"
  | "sub-post"
  | "comment"
  | "subreddit"
  | "other";

// Attribution: did the user we're investigating actually write this post /
// comment, or does the URL only mention them? A Google search for
// `<username> site:reddit.com` returns any Reddit page that contains that
// string — so without verification we can't tell the two apart. The
// attribution worker (features/google-harvest/attribution.ts) fetches each
// post's `.json` from Reddit and resolves this field.
//
//   "authored"  — confirmed: post author or a visible commenter matches
//   "mentioned" — confirmed: the user's name appears but they didn't write
//   "unknown"   — unverified (default) or verification couldn't determine
//                 (e.g. deleted/removed content)
//
// `attributionCheckedAt: null` plus `attribution: "unknown"` is the signal
// that the worker should look at this post. Anything with a non-null
// `attributionCheckedAt` is considered settled and won't be rechecked.
export type GoogleHarvestAttribution = "authored" | "mentioned" | "unknown";

export interface GoogleHarvestPost {
  url: string;
  kind: GoogleHarvestPostKind;
  subreddit: string | null;
  postId: string | null;
  slug: string | null;
  title: string;
  ageHint: string | null;
  commentCountHint: number | null;
  snippetText: string;
  firstSeenAt: number;
  lastSeenAt: number;
  attribution: GoogleHarvestAttribution;
  attributionCheckedAt: number | null;
  attributionAttempts: number;
}

export interface GoogleHarvest {
  firstCapturedAt: number;
  lastCapturedAt: number;
  captureCount: number;
  query: string;
  posts: GoogleHarvestPost[];
  subredditDistribution: Record<string, number>;

  // Subset of subredditDistribution counting only attribution: "authored"
  // posts. This is the trustworthy sub-clustering signal — entries here
  // are subs the user actually participated in, not subs where someone
  // else mentioned their username.
  authoredSubredditDistribution: Record<string, number>;
  kinds: Record<GoogleHarvestPostKind, number>;
}

// Posts / comments scraped passively from Reddit's DOM as the operator
// browses, for users whose profile we already know is hidden (so an
// investigation can't reach their content via the API). Each item is
// self-attributing — the harvester only captures from a username byline
// we see on a post or comment in the wild. Stored per-user, capped at a
// fixed item count (oldest firstSeenAt evicted first) so the buffer
// can't grow without bound.
//
// Merge semantics mirror GoogleHarvest: items are unioned by canonical
// permalink, firstSeenAt is immutable, lastSeenAt refreshes every time
// the same permalink is seen again.
export type PassiveHarvestItemKind = "post" | "comment";

export interface PassiveHarvestItem {
  kind: PassiveHarvestItemKind;
  permalink: string;
  subreddit: string | null;
  postTitle: string | null;
  bodyExcerpt: string;
  createdAt: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface PassiveHarvest {
  firstSeenAt: number;
  lastSeenAt: number;
  captureCount: number;
  items: PassiveHarvestItem[];
  subredditDistribution: Record<string, number>;
  kinds: Record<PassiveHarvestItemKind, number>;
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
  totalKarma: number | null;
  botBouncerStatus: BotBouncerStatus;
  botBouncerCheckedAt: number;
  investigation: Investigation | null;
  activityData: ActivityData | null;
  ringId: string | null;
  userNotes: UserNotes | null;
  googleHarvest: GoogleHarvest | null;

  // Set true on investigation completion when the threshold defined in
  // the prompt's "Hidden profile handling" section is met
  // (posts_fetched + comments_fetched ≤ 5 && total_karma ≥ 1000). Gates
  // whether the passive-harvest content-script captures DOM content for
  // this username — we only spend the cycles for accounts whose API
  // path can't reach their content.
  profileHidden: boolean;
  passiveHarvest: PassiveHarvest | null;
}

// Result of a one-click "is this subreddit compromised" analysis. Stored
// per-subreddit, keyed by lowercase subreddit name. We sample N post-authors
// from the subreddit's feed, then reuse or enqueue per-user investigations.
// The verdict is *not* persisted — it's derived live from the sampled users'
// current Report records (see src/features/subreddit-investigation/verdict.ts),
// the same way the per-user Verdict derives from factor scores. That means
// the badge stays accurate as individual investigations complete in the
// background, without us writing back to the SubredditReport.
export interface SubredditReport {
  name: string;
  analyzedAt: number;
  sampledUsernames: string[];
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

  // Unix epoch seconds. Per-item timestamps are numeric (not ISO) so 300 of
  // them don't bloat the input; the account-level created_at stays ISO.
  created_at: number | null;
  removed_by_category: string | null;
}

export interface SummaryComment {
  subreddit: string;
  body_excerpt: string;
  score: number | null;
  created_at: number | null;
  link_title: string | null;
  removed_by_category: string | null;
}

export interface ProfileSummary {
  username: string;
  account: AccountSummary;

  // Snoovatar customization flag. When `customized: true`, the user
  // message also carries the avatar PNG as an image content block — the
  // prompt's `avatar_style` factor scores it. `customized: false` means
  // the default snoo; no image is attached.
  avatar: { customized: boolean };
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

  // Posts surfaced by a user-initiated Google site:reddit.com search for
  // this username. Present only when the user has clicked "Search Google"
  // at least once. The shape mirrors the GoogleHarvest stored on Report,
  // minus the capturedAt timestamp.
  google_harvest?: GoogleHarvest;

  // Posts / comments scraped passively from Reddit's DOM as the operator
  // browses, for hidden-profile users we've already investigated. Same
  // role as google_harvest — supplemental enrichment that gives Claude
  // visibility into a hidden account's behavior — but the items come
  // from Reddit feeds the operator happened to be on, not from a
  // SERP. Sample is biased toward subs the operator browses; the prompt
  // weights it accordingly.
  passive_harvest?: PassiveHarvest;
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

    // Customized snoovatar PNG. Empty string when the account uses the
    // default snoo — only treat a non-empty URL as a customization signal.
    snoovatar_img?: string;
    icon_img?: string;
  };
}

export interface RedditListing<T = Record<string, unknown>> {
  data?: {
    after?: string | null;
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
