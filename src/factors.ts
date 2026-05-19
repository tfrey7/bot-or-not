// Canonical factor list — single source of truth for factor metadata across
// the extension's UI and analyzer.
//
// CONTRACT: bot_analysis.md must list factors in this exact order, with these
// exact keys. If you add/remove/rename a factor here, update the prompt file
// so the data Claude returns matches what the UI expects.

import type { ArchetypeKey, PersonaLabel } from "./types.ts";

export interface FactorMeta {
  key: string;
  label: string;
}

export const BON_FACTORS: readonly FactorMeta[] = [
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
  { key: "promotional_account", label: "Promotional account" },
];

export const BON_FACTOR_KEYS: readonly string[] = BON_FACTORS.map(
  (factor) => factor.key
);

export const BON_FACTOR_LABELS: Record<string, string> = Object.fromEntries(
  BON_FACTORS.map((factor) => [factor.key, factor.label])
);

export interface ArchetypeMeta {
  key: ArchetypeKey;
  label: string;
  hue: number;
}

// Persona archetype axes for the radar chart. Each is an independent 0–1
// strength score Claude produces in `persona.archetypes` — `bot_analysis.md`
// must keep the same keys, in the same order, since the chart walks this list
// to lay out vertices clockwise from the top.
//
// `hue` positions the archetype on the HSL color wheel (0–360). The persona
// card's accent is computed from this hue, and when a blend kicks in the hue
// is interpolated along the shorter arc — so combo titles get a naturally
// in-between color (Cam Hustler = hustler teal pulled toward thirst magenta).
//
// Axes describe flavors of *human* behavior. `bot` is not on the radar — the
// bot↔human verdict already answers that question, so giving it a spoke would
// double-count. `bot` and `normal` remain valid `persona.label` values though
// (an account that isn't a flavor of human is still labelled, just with an
// empty radar).
export const BON_ARCHETYPES: readonly ArchetypeMeta[] = [
  { key: "stan", label: "Stan", hue: 45 },
  { key: "farmer", label: "Farmer", hue: 210 },
  { key: "teen", label: "Teen", hue: 95 },
  { key: "thirst", label: "Thirst", hue: 320 },
  { key: "crank", label: "Crank", hue: 0 },
  { key: "hustler", label: "Hustler", hue: 155 },
  { key: "doomer", label: "Doomer", hue: 260 },
];

export const BON_ARCHETYPE_KEYS: readonly ArchetypeKey[] = BON_ARCHETYPES.map(
  (archetype) => archetype.key
);

// `bot` and `normal` are valid persona labels but not radar axes — the chart
// only plots human-flavor archetypes. `bot` = automated; `normal` = a genuine,
// low-key human with no strong pull toward any of the named archetypes.
export const BON_PERSONA_LABELS: readonly PersonaLabel[] = [
  ...BON_ARCHETYPE_KEYS,
  "bot",
  "normal",
];
