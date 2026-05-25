// Language-marker region signal: regex-matches characteristic words/tokens
// for languages that can't be detected by script alone (e.g. Portuguese vs
// Spanish vs Italian — all Latin script). Picks up to a handful of distinct
// sample matches per language for the UI to surface as evidence.

import { LANGUAGE_MARKERS } from "./data.ts";

const LANGUAGE_SAMPLE_LIMIT = 4;

export function regionsDetectLanguageMarkers(text: string): {
  counts: Record<string, number>;
  samples: Record<string, string[]>;
} {
  if (!text) {
    return { counts: {}, samples: {} };
  }

  const counts: Record<string, number> = {};
  const samples: Record<string, string[]> = {};

  for (const [name, marker] of Object.entries(LANGUAGE_MARKERS)) {
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

export function inferRegionFromLanguage(
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

    const marker = LANGUAGE_MARKERS[name];
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
