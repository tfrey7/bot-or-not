// Region inference from Reddit posting history + posting-timezone analysis.
//
// Surfaces a "where is this account active?" signal alongside the AI verdict
// and the activity heatmap. Two inputs:
//   1) Subreddit-based: counts of activity in country-coded subs (r/india,
//      r/pakistan, r/IndianGaming, r/brasil, …). Strong signal — a user
//      participating regularly in country-specific subs is almost always
//      from that country.
//   2) Timezone-based: the sleep-window inference reports.js already does
//      from posting timestamps. Coarser — a UTC offset narrows things to a
//      band of longitudes, not a country.
//
// Combined, they disambiguate each other: UTC+5 alone could be Pakistan,
// India (≈+5.5 → rounds to either), Kazakhstan, Maldives. Pair with heavy
// r/india activity and you have India with high confidence.

import type { ActivityData } from "../../types.ts";
import {
  BON_LANGUAGE_MARKERS,
  BON_REGION_INFO,
  BON_REGION_SUB_PATTERNS,
  BON_REGION_SUBS,
  BON_SCRIPT_RANGES,
} from "./data.ts";

export function bonNormalizeSubName(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
}

// Resolves a normalized sub name to a region code. Exact match first (the
// curated table in data.ts is the canonical truth); falls back to regex
// patterns for the long tail (r/indian_*, r/pakistani_*, …).
function lookupSubRegion(normalizedSub: string): string | undefined {
  if (!normalizedSub) {
    return undefined;
  }

  const exact = BON_REGION_SUBS[normalizedSub];
  if (exact) {
    return exact;
  }

  for (const { pattern, region } of BON_REGION_SUB_PATTERNS) {
    if (pattern.test(normalizedSub)) {
      return region;
    }
  }

  return undefined;
}

export interface SubRegionHit {
  sub: string;
  count: number;
}

export interface SubregionInference {
  region: string;
  count: number;
  totalFlagged: number;
  share: number;
  hits: SubRegionHit[];
  runnerUp: { region: string; count: number } | null;
}

// Returns null if no flagged subs touched, otherwise:
//   { region, count, totalFlagged, share, hits, runnerUp }
// where hits is the per-sub breakdown for the top region, sorted.
export function bonInferRegionFromSubreddits(
  subredditCounts: Record<string, number> | null | undefined
): SubregionInference | null {
  if (!subredditCounts) {
    return null;
  }

  const totals: Record<string, number> = Object.create(null);
  const hitsByRegion: Record<string, SubRegionHit[]> = Object.create(null);
  let totalFlagged = 0;

  for (const [sub, count] of Object.entries(subredditCounts)) {
    if (!count) {
      continue;
    }

    const region = lookupSubRegion(bonNormalizeSubName(sub));
    if (!region) {
      continue;
    }

    totals[region] = (totals[region] || 0) + count;
    (hitsByRegion[region] = hitsByRegion[region] || []).push({ sub, count });
    totalFlagged += count;
  }

  if (totalFlagged === 0) {
    return null;
  }

  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const [topRegion, topCount] = ranked[0];

  const runnerUp = ranked[1]
    ? { region: ranked[1][0], count: ranked[1][1] }
    : null;

  return {
    region: topRegion,
    count: topCount,
    totalFlagged,
    share: topCount / totalFlagged,
    hits: hitsByRegion[topRegion].sort((a, b) => b.count - a.count),
    runnerUp,
  };
}

function bonDetectScripts(text: string): Record<string, number> {
  if (!text) {
    return {};
  }

  const counts: Record<string, number> = {};

  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    i += codePoint > 0xffff ? 2 : 1;

    for (const range of BON_SCRIPT_RANGES) {
      if (codePoint >= range.range[0] && codePoint <= range.range[1]) {
        counts[range.name] = (counts[range.name] || 0) + 1;
        break;
      }
    }
  }

  return counts;
}

const LANGUAGE_SAMPLE_LIMIT = 4;

function bonDetectLanguageMarkers(text: string): {
  counts: Record<string, number>;
  samples: Record<string, string[]>;
} {
  if (!text) {
    return { counts: {}, samples: {} };
  }

  const counts: Record<string, number> = {};
  const samples: Record<string, string[]> = {};

  for (const [name, marker] of Object.entries(BON_LANGUAGE_MARKERS)) {
    const matches = text.match(marker.pattern);
    if (!matches || matches.length === 0) {
      continue;
    }

    counts[name] = matches.length;

    const seen = new Set<string>();
    const picked: string[] = [];

    for (const match of matches) {
      const normalized = match.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      picked.push(match);
      if (picked.length >= LANGUAGE_SAMPLE_LIMIT) {
        break;
      }
    }

    samples[name] = picked;
  }

  return { counts, samples };
}

// One-shot scan over a concatenated text corpus. Run during the investigation
// fetch — output is stored in activityData.{scriptSignals,languageSignals,languageSamples}.
export function bonScanTextSignals(text: string): {
  scripts: Record<string, number>;
  languages: Record<string, number>;
  languageSamples: Record<string, string[]>;
} {
  const detected = bonDetectLanguageMarkers(text);
  return {
    scripts: bonDetectScripts(text),
    languages: detected.counts,
    languageSamples: detected.samples,
  };
}

export interface ScriptInference {
  region: string;
  score: number;
  hits: Array<{ script: string; count: number; regions: string[] }>;
}

export function bonInferRegionFromScripts(
  scriptCounts: Record<string, number> | null | undefined
): ScriptInference | null {
  if (!scriptCounts) {
    return null;
  }

  const votes: Record<string, number> = {};
  const hits: ScriptInference["hits"] = [];

  for (const [name, count] of Object.entries(scriptCounts)) {
    if (!count) {
      continue;
    }

    const range = BON_SCRIPT_RANGES.find((entry) => entry.name === name);
    if (!range) {
      continue;
    }

    hits.push({ script: name, count, regions: range.regions });

    // Split votes across plausible regions for ambiguous scripts.
    const share = count / range.regions.length;

    for (const region of range.regions) {
      votes[region] = (votes[region] || 0) + share;
    }
  }

  if (Object.keys(votes).length === 0) {
    return null;
  }

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return { region: ranked[0][0], score: ranked[0][1], hits };
}

export interface LanguageInference {
  region: string;
  score: number;
  hits: Array<{
    language: string;
    label: string;
    count: number;
    regions: string[];
    samples: string[];
  }>;
}

export function bonInferRegionFromLanguage(
  languageCounts: Record<string, number> | null | undefined,
  languageSamples?: Record<string, string[]> | null | undefined
): LanguageInference | null {
  if (!languageCounts) {
    return null;
  }

  const votes: Record<string, number> = {};
  const hits: LanguageInference["hits"] = [];

  for (const [name, count] of Object.entries(languageCounts)) {
    if (!count) {
      continue;
    }

    const marker = BON_LANGUAGE_MARKERS[name];
    if (!marker) {
      continue;
    }

    hits.push({
      language: name,
      label: marker.label,
      count,
      regions: marker.regions,
      samples: languageSamples?.[name] ?? [],
    });

    const share = count / marker.regions.length;

    for (const region of marker.regions) {
      votes[region] = (votes[region] || 0) + share;
    }
  }

  if (Object.keys(votes).length === 0) {
    return null;
  }

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return { region: ranked[0][0], score: ranked[0][1], hits };
}

// Coarse UTC-offset → region-band label for the inferred-timezone strip.
// Returns "" for offsets outside the commonly-populated bands.
export function bonRegionForOffset(offset: number): string {
  if (offset === 0) {
    return "UK, Portugal, West Africa";
  }

  if (offset === 1) {
    return "Western/Central Europe";
  }

  if (offset === 2) {
    return "Eastern Europe, South Africa";
  }

  if (offset === 3) {
    return "Moscow, Eastern Europe, East Africa";
  }

  if (offset === 4) {
    return "Gulf, Caucasus";
  }

  if (offset === 5) {
    return "Pakistan, West Asia";
  }

  if (offset === 6) {
    return "India, Bangladesh";
  }

  if (offset === 7) {
    return "Thailand, Vietnam, Indonesia";
  }

  if (offset === 8) {
    return "China, Singapore, Philippines";
  }

  if (offset === 9) {
    return "Japan, Korea";
  }

  if (offset === 10) {
    return "Eastern Australia";
  }

  if (offset === 11) {
    return "Solomon Islands";
  }

  if (offset === 12) {
    return "New Zealand";
  }

  if (offset === -1) {
    return "Azores, Cape Verde";
  }

  if (offset === -2) {
    return "Mid-Atlantic";
  }

  if (offset === -3) {
    return "Brazil, Argentina";
  }

  if (offset === -4) {
    return "Atlantic, Eastern Caribbean";
  }

  if (offset === -5) {
    return "US Eastern, Colombia, Peru";
  }

  if (offset === -6) {
    return "US Central, Mexico";
  }

  if (offset === -7) {
    return "US Mountain";
  }

  if (offset === -8) {
    return "US Pacific";
  }

  if (offset === -9) {
    return "Alaska";
  }

  if (offset === -10) {
    return "Hawaii";
  }

  return "";
}

export interface ModeratedInference {
  region: string;
  score: number;
  hits: Array<{ sub: string; region: string }>;
}

export function bonInferRegionFromModerated(
  moderatedSubs: string[] | null | undefined
): ModeratedInference | null {
  if (!Array.isArray(moderatedSubs) || moderatedSubs.length === 0) {
    return null;
  }

  const votes: Record<string, number> = {};
  const hits: ModeratedInference["hits"] = [];

  for (const sub of moderatedSubs) {
    const region = lookupSubRegion(bonNormalizeSubName(sub));
    if (!region) {
      continue;
    }

    votes[region] = (votes[region] || 0) + 1;
    hits.push({ sub, region });
  }

  if (Object.keys(votes).length === 0) {
    return null;
  }

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return { region: ranked[0][0], score: ranked[0][1], hits };
}

export interface TzInferred {
  kind: "inferred";
  offsetHours: number;
}

export interface DeterministicRegionInference {
  kind: "deterministic";
  region: string;
  score: number;
  subreddit: SubregionInference | null;
  scriptSignal: ScriptInference | null;
  languageSignal: LanguageInference | null;
  moderator: ModeratedInference | null;
  tzOffset: number | null;
  tzMatch: boolean | null;
  runnerUp: { region: string; score: number } | null;
}

export interface TimezoneOnlyRegionInference {
  kind: "timezone-only";
  offsetHours: number;
  possibleRegions: string[];
}

// AI-picked region. Carries the deterministic result alongside so the UI can
// surface supporting evidence (e.g. matching country-coded sub hits) and call
// out contradictions (AI says US, deterministic says RU because of Cyrillic).
export interface AiRegionInference {
  kind: "ai";
  region: string;
  confidence: number;
  reasoning: string;
  deterministic:
    | DeterministicRegionInference
    | TimezoneOnlyRegionInference
    | null;
}

// Output of the deterministic pipeline alone (no AI input). Used as the
// `deterministic` slot on AiRegionInference and as the standalone result
// when no AI investigation has run yet.
export type DeterministicRegionResult =
  | DeterministicRegionInference
  | TimezoneOnlyRegionInference
  | null;

export type RegionInferenceResult =
  | DeterministicRegionResult
  | AiRegionInference;

// Combine all deterministic signals (subreddit, script, language, moderator)
// plus timezone, picking the region with the highest weighted score.
// `tzInferred` is the result of reports.js inferTimezoneFromTimestamps().
export function bonInferRegion(
  activityData: ActivityData | null | undefined,
  tzInferred: TzInferred | { kind: string } | null | undefined
): DeterministicRegionResult {
  const subredditResult = activityData
    ? bonInferRegionFromSubreddits(activityData.subredditCounts)
    : null;
  const scriptResult = activityData
    ? bonInferRegionFromScripts(activityData.scriptSignals)
    : null;
  const languageResult = activityData
    ? bonInferRegionFromLanguage(
        activityData.languageSignals,
        activityData.languageSamples
      )
    : null;
  const moderatorResult = activityData
    ? bonInferRegionFromModerated(activityData.moderatedSubs)
    : null;
  const timezoneOffset =
    tzInferred?.kind === "inferred"
      ? (tzInferred as TzInferred).offsetHours
      : null;

  // Weighted points per source. Calibrated so:
  //  - Moderating a country sub is the single strongest signal (anyone trusted
  //    to mod a region sub is overwhelmingly from that region).
  //  - Subreddit participation, scripts, and language markers are all strong
  //    primary signals; multiple agreeing sources push score sharply higher.
  //  - Timezone is a tie-breaker, never a primary signal — it only bonuses
  //    regions already nominated by something else.
  const scores: Record<string, number> = {};
  function addScore(region: string, points: number): void {
    scores[region] = (scores[region] || 0) + points;
  }

  if (subredditResult) {
    addScore(
      subredditResult.region,
      3 + Math.min(subredditResult.count - 1, 5)
    );
  }

  if (scriptResult) {
    // 1 point per script char up to 5 bonus, plus 3 base — even 1 Devanagari
    // char is decisive (no organic English text contains it).
    addScore(
      scriptResult.region,
      3 + Math.min(Math.floor(scriptResult.score), 5)
    );
  }

  if (languageResult) {
    addScore(
      languageResult.region,
      3 + Math.min(Math.floor(languageResult.score / 2), 5)
    );
  }

  if (moderatorResult) {
    addScore(
      moderatorResult.region,
      6 + Math.min(moderatorResult.score - 1, 5)
    );
  }

  if (timezoneOffset != null) {
    for (const region of Object.keys(scores)) {
      const offsets = BON_REGION_INFO[region]?.utcOffsets || [];
      if (offsets.includes(timezoneOffset)) {
        scores[region] += 1;
      }
    }
  }

  if (Object.keys(scores).length > 0) {
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topRegion, topScore] = ranked[0];

    const tzMatch =
      timezoneOffset != null
        ? !!BON_REGION_INFO[topRegion]?.utcOffsets?.includes(timezoneOffset)
        : null;

    return {
      kind: "deterministic",
      region: topRegion,
      score: topScore,
      subreddit: subredditResult,
      scriptSignal: scriptResult,
      languageSignal: languageResult,
      moderator: moderatorResult,
      tzOffset: timezoneOffset,
      tzMatch,
      runnerUp: ranked[1]
        ? { region: ranked[1][0], score: ranked[1][1] }
        : null,
    };
  }

  if (tzInferred?.kind === "inferred") {
    const offsetHours = (tzInferred as TzInferred).offsetHours;
    const possibleRegions = Object.entries(BON_REGION_INFO)
      .filter(([, info]) => info.utcOffsets.includes(offsetHours))
      .map(([code]) => code);

    return {
      kind: "timezone-only",
      offsetHours,
      possibleRegions,
    };
  }

  return null;
}
