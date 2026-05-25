// Canonical factor list — single source of truth for factor metadata across
// the extension's UI and analyzer.
//
// CONTRACT: src/features/investigation/prompt.md must list factors in this
// exact order, with these exact keys. If you add/remove/rename a factor here,
// update the prompt file so the data Claude returns matches what the UI expects.

import type { ArchetypeKey, PersonaLabel } from "./types.ts";

export interface FactorMeta {
  key: string;
  label: string;
}

export const FACTORS: readonly FactorMeta[] = [
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
  { key: "avatar_style", label: "Avatar style" },
];

export const FACTOR_KEYS: readonly string[] = FACTORS.map(
  (factor) => factor.key
);

export const FACTOR_LABELS: Record<string, string> = Object.fromEntries(
  FACTORS.map((factor) => [factor.key, factor.label])
);

export interface ArchetypeMeta {
  key: ArchetypeKey;
  label: string;
  hue: number;

  // One- or two-sentence user-facing description shown on the personas page.
  // The long-form analyst definitions in features/investigation/prompt.md are
  // too dense for the UI; this is the plain-English version.
  blurb: string;
}

// Persona archetype axes for the radar chart. Each is an independent 0–1
// strength score Claude produces in `persona.archetypes` — the investigation
// prompt must keep the same keys, in the same order, since the chart walks
// this list to lay out vertices clockwise from the top.
//
// `hue` positions the archetype on the HSL color wheel (0–360). The persona
// card's accent is computed from this hue, and when a blend kicks in the hue
// is interpolated along the shorter arc — so combo titles get a naturally
// in-between color (Affiliate Spam = farmer blue pulled toward hustler teal).
//
// Axes describe flavors of *human* behavior. `bot` is not on the radar — the
// bot↔human verdict already answers that question, so giving it a spoke would
// double-count. `bot` and `normal` remain valid `persona.label` values though
// (an account that isn't a flavor of human is still labelled, just with an
// empty radar). Age inference is handled separately in the demographics block
// on the investigation result, not as an archetype axis.
// Order matters — drives radar placement clockwise from the top. The order
// here walks the HSL color wheel smoothly so adjacent axes share neighboring
// hues (yellow → teal → blue → purple → magenta → red → back to yellow).
// Blended combo colors then interpolate to something visually between the
// two anchors, instead of leaping across the wheel.
export const ARCHETYPES: readonly ArchetypeMeta[] = [
  {
    key: "stan",
    label: "Stan",
    hue: 45,
    blurb:
      "A human hyperfocused on one niche — a fandom, regional community, identity community, or earnestly-advocated cause. Posts heavily in a few themed subs with fluent in-group voice.",
  },
  {
    key: "hustler",
    label: "Hustler",
    hue: 155,
    blurb:
      "A commercial-vehicle account that drives attention to a product, service, or person the operator profits from — crypto pumps, dropship stores, MLM funnels, paid courses, indie apps.",
  },
  {
    key: "farmer",
    label: "Farmer",
    hue: 210,
    blurb:
      "Human-operated but inauthentic. Reposts viral content, drops generic engagement-bait (“This!”, “Underrated take”), scatters across unrelated big subs to harvest karma.",
  },
  {
    key: "doomer",
    label: "Doomer",
    hue: 260,
    blurb:
      "Pessimist / burnout poster. Worldview is “things are getting worse and there’s no fix” — heavy on r/collapse, r/antiwork, layoff threads, late-stage-capitalism takes.",
  },
  {
    key: "cam_model",
    label: "Cam Model",
    hue: 320,
    blurb:
      "A commercial account whose product is the operator’s own appearance. The selfies are the business; the Reddit presence funnels subscribers to OnlyFans, Fansly, or a cam site.",
  },
  {
    key: "zealot",
    label: "Zealot",
    hue: 0,
    blurb:
      "Single-issue political combatant. Reddit is their battlefield: daily outrage, tribal antagonism, every news item treated as ammunition for the cause.",
  },
];

export const ARCHETYPE_KEYS: readonly ArchetypeKey[] = ARCHETYPES.map(
  (archetype) => archetype.key
);

// `bot` and `normal` are valid persona labels but not radar axes — the chart
// only plots human-flavor archetypes. `bot` = automated; `normal` = a genuine,
// low-key human with no strong pull toward any of the named archetypes.
export const PERSONA_LABELS: readonly PersonaLabel[] = [
  ...ARCHETYPE_KEYS,
  "bot",
  "normal",
];
