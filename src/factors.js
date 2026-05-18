// Canonical factor list — single source of truth for factor metadata across
// the extension's UI and analyzer. Plain script (no ES modules) so it can be
// loaded by background scripts and HTML pages alike.
//
// CONTRACT: bot_analysis.md must list factors in this exact order, with these
// exact keys. If you add/remove/rename a factor here, update the prompt file
// so the data Claude returns matches what the UI expects.

var BON_FACTORS = [
  { key: "account_age_vs_activity", label: "Account age vs activity" },
  { key: "dormant_account_revival", label: "Dormant account revival" },
  { key: "karma_farming_subs", label: "Karma-farming subreddits" },
  { key: "fake_political_subs", label: "Fake political subreddits" },
  { key: "llm_content_style", label: "LLM-generated content style" },
  { key: "timestamp_patterns", label: "Posting timestamp patterns" },
  { key: "topical_drift", label: "Topical drift / inconsistency" },
  { key: "engagement_patterns", label: "Engagement patterns" },
  { key: "username_pattern", label: "Username pattern" },
  { key: "hidden_post_history", label: "Hidden post history" },
  { key: "bot_bouncer_status", label: "Bot Bouncer status" },
  { key: "moderator_removal_history", label: "Moderator removal history" },
  { key: "posting_volume", label: "Posting volume" },
  { key: "moderated_subreddits", label: "Moderated subreddits" },
];

var BON_FACTOR_KEYS = BON_FACTORS.map((f) => f.key);

var BON_FACTOR_LABELS = Object.fromEntries(
  BON_FACTORS.map((f) => [f.key, f.label])
);

// Persona archetype axes for the radar chart. Each is an independent 0–1
// strength score Claude produces in `persona.archetypes` — `bot_analysis.md`
// must keep the same keys, in the same order, since the chart walks this list
// to lay out vertices clockwise from the top.
//
// `label` is the short tag rendered next to the axis. `color` is a CSS var
// used to tint the data polygon when this axis is the dominant pick.
//
// Axes describe flavors of *human* behavior. `bot` is not on the radar — the
// bot↔human verdict already answers that question, so giving it a spoke would
// double-count. `bot` and `normal` remain valid `persona.label` values though
// (an account that isn't a flavor of human is still labelled, just with an
// empty radar).
var BON_ARCHETYPES = [
  { key: "stan", label: "Stan", color: "var(--bon-stamp-amber)" },
  { key: "farmer", label: "Farmer", color: "var(--bon-stamp-blue)" },
  { key: "teen", label: "Teen", color: "var(--bon-stamp-moss)" },
  { key: "thirst", label: "Thirst", color: "var(--bon-stamp-rust)" },
  { key: "crank", label: "Crank", color: "var(--bon-stamp-red)" },
  { key: "hustler", label: "Hustler", color: "var(--bon-stamp-forest)" },
  { key: "doomer", label: "Doomer", color: "var(--bon-stamp-slate)" },
];

var BON_ARCHETYPE_KEYS = BON_ARCHETYPES.map((a) => a.key);

// `bot` and `normal` are valid persona labels but not radar axes — the chart
// only plots human-flavor archetypes. `bot` = automated; `normal` = a genuine,
// low-key human with no strong pull toward any of the named archetypes.
var BON_PERSONA_LABELS = [...BON_ARCHETYPE_KEYS, "bot", "normal"];
