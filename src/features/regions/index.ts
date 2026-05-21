// Region inference from Reddit posting history + posting-timezone analysis.
//
// Surfaces a "where is this account active?" signal alongside the AI verdict
// and the activity heatmap. Per-signal modules:
//   - subreddit.ts: counts of activity in country-coded subs (r/india,
//     r/pakistan, r/IndianGaming, r/brasil, …). Strong signal — a user
//     participating regularly in country-specific subs is almost always
//     from that country.
//   - scripts.ts: non-Latin code points in their writing (Devanagari,
//     Arabic, Cyrillic, CJK, …).
//   - language.ts: regex markers for languages indistinguishable by script
//     alone (Portuguese vs Spanish vs Italian, all Latin).
//   - moderated.ts: country subs the user *moderates* (stronger per-hit
//     than just participating).
//   - timezone.ts: sleep-window-inferred UTC offset → longitude band. The
//     coarsest signal; used as a tie-breaker bonus, never as a primary
//     input — UTC+5 alone could be Pakistan, India, Kazakhstan, Maldives.
//
// `bonInferRegion` combines them into a single weighted pick.

import type { ActivityData } from "../../types.ts";
import { BON_REGION_INFO } from "./data.ts";
import {
  bonInferRegionFromSubreddits,
  type SubregionInference,
} from "./subreddit.ts";
import {
  bonInferRegionFromScripts,
  bonRegionsDetectScripts,
  type ScriptInference,
} from "./scripts.ts";
import {
  bonInferRegionFromLanguage,
  bonRegionsDetectLanguageMarkers,
  type LanguageInference,
} from "./language.ts";
import {
  bonInferRegionFromModerated,
  type ModeratedInference,
} from "./moderated.ts";
import type { TimezoneOnlyRegionInference, TzInferred } from "./timezone.ts";

export { bonNormalizeSubName } from "./subreddit.ts";
export type { SubRegionHit, SubregionInference } from "./subreddit.ts";
export type { ScriptInference } from "./scripts.ts";
export type { LanguageInference } from "./language.ts";
export type { ModeratedInference } from "./moderated.ts";
export {
  bonRegionForOffset,
  type TimezoneOnlyRegionInference,
  type TzInferred,
} from "./timezone.ts";

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

// One-shot scan over a concatenated text corpus. Run during the investigation
// fetch — output is stored in activityData.{scriptSignals,languageSignals,languageSamples}.
export function bonScanTextSignals(text: string): {
  scripts: Record<string, number>;
  languages: Record<string, number>;
  languageSamples: Record<string, string[]>;
} {
  const detected = bonRegionsDetectLanguageMarkers(text);
  return {
    scripts: bonRegionsDetectScripts(text),
    languages: detected.counts,
    languageSamples: detected.samples,
  };
}

// Combine all deterministic signals (subreddit, script, language, moderator)
// plus timezone, picking the region with the highest weighted score.
// `tzInferred` is the result of reports' inferTimezoneFromTimestamps().
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
  //  - Diaspora-attracting regions (US, Israel) are filtered out of the
  //    subreddit pipeline upstream — see bonInferRegionFromSubreddits.
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
