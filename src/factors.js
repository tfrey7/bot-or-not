// Canonical factor list — single source of truth for factor metadata across
// the extension's UI and analyzers. Plain script (no ES modules) so it can be
// loaded by background scripts and HTML pages alike.
//
// CONTRACT: bot_analysis.md (1D bot↔human prompt) AND bot_analysis_triangle.md
// (triangle prompt, when written) must list factors in this exact order, with
// these exact keys. If you add/remove/rename a factor here, update both prompt
// files so the data Claude returns matches what the UI expects.
//
// `triangleVertices` declares which corners a factor can pull a user toward in
// the triangle analysis. Univariate factors (a single vertex) are red flags
// for one archetype only — e.g., a Bot Bouncer flag is purely a Bot signal,
// no Stan or Farmer information. Multi-vertex factors can pull in multiple
// directions depending on what Claude observes.

var BON_FACTORS = [
  {
    key: "account_age_vs_activity",
    label: "Account age vs activity",
    triangleVertices: ["bot", "stan"],
  },
  {
    key: "dormant_account_revival",
    label: "Dormant account revival",
    triangleVertices: ["bot", "farmer"],
  },
  {
    key: "karma_farming_subs",
    label: "Karma-farming subreddits",
    triangleVertices: ["farmer"],
  },
  {
    key: "fake_political_subs",
    label: "Fake political subreddits",
    triangleVertices: ["bot", "farmer"],
  },
  {
    key: "llm_content_style",
    label: "LLM-generated content style",
    triangleVertices: ["bot"],
  },
  {
    key: "timestamp_patterns",
    label: "Posting timestamp patterns",
    triangleVertices: ["bot"],
  },
  {
    key: "topical_drift",
    label: "Topical drift / inconsistency",
    triangleVertices: ["bot", "farmer"],
  },
  {
    key: "engagement_patterns",
    label: "Engagement patterns",
    triangleVertices: ["bot", "stan", "farmer"],
  },
  {
    key: "username_pattern",
    label: "Username pattern",
    triangleVertices: ["bot"],
  },
  {
    key: "hidden_post_history",
    label: "Hidden post history",
    triangleVertices: ["bot"],
  },
  {
    key: "bot_bouncer_status",
    label: "Bot Bouncer status",
    triangleVertices: ["bot"],
  },
  {
    key: "moderator_removal_history",
    label: "Moderator removal history",
    triangleVertices: ["bot", "farmer"],
  },
  {
    key: "posting_volume",
    label: "Posting volume",
    triangleVertices: ["bot", "farmer"],
  },
  {
    key: "moderated_subreddits",
    label: "Moderated subreddits",
    triangleVertices: ["bot", "stan", "farmer"],
  },
];

var BON_FACTOR_KEYS = BON_FACTORS.map((f) => f.key);

var BON_FACTOR_LABELS = Object.fromEntries(
  BON_FACTORS.map((f) => [f.key, f.label])
);
