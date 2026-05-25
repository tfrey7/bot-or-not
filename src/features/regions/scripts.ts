// Script-based region signal: counts code points in non-Latin script ranges
// (Devanagari, Arabic, Cyrillic, CJK, …) and votes for the regions those
// scripts are spoken in. Even a single non-Latin code point in an otherwise-
// English corpus is decisive — organic English text doesn't contain
// Devanagari.

import { SCRIPT_RANGES } from "./data.ts";

export function regionsDetectScripts(text: string): Record<string, number> {
  if (!text) {
    return {};
  }

  const counts: Record<string, number> = {};

  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    i += codePoint > 0xffff ? 2 : 1;

    for (const range of SCRIPT_RANGES) {
      if (codePoint >= range.range[0] && codePoint <= range.range[1]) {
        counts[range.name] = (counts[range.name] || 0) + 1;
        break;
      }
    }
  }

  return counts;
}

export interface ScriptInference {
  region: string;
  score: number;
  hits: Array<{ script: string; count: number; regions: string[] }>;
}

export function inferRegionFromScripts(
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

    const range = SCRIPT_RANGES.find((entry) => entry.name === name);
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
