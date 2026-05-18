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

import {
  BON_LANGUAGE_MARKERS,
  BON_REGION_INFO,
  BON_REGION_SUBS,
  BON_SCRIPT_RANGES,
} from "./data.js";

export function bonNormalizeSubName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
}

// Returns null if no flagged subs touched, otherwise:
//   { region, count, totalFlagged, share, hits, runnerUp }
// where hits is the per-sub breakdown for the top region, sorted.
export function bonInferRegionFromSubreddits(subredditCounts) {
  if (!subredditCounts) {
    return null;
  }
  const totals = Object.create(null);
  const hitsByRegion = Object.create(null);
  let totalFlagged = 0;
  for (const [sub, count] of Object.entries(subredditCounts)) {
    if (!count) {
      continue;
    }
    const region = BON_REGION_SUBS[bonNormalizeSubName(sub)];
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

function bonDetectScripts(text) {
  if (!text) {
    return {};
  }
  const counts = {};
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    i += cp > 0xffff ? 2 : 1;
    for (const r of BON_SCRIPT_RANGES) {
      if (cp >= r.range[0] && cp <= r.range[1]) {
        counts[r.name] = (counts[r.name] || 0) + 1;
        break;
      }
    }
  }
  return counts;
}

function bonDetectLanguageMarkers(text) {
  if (!text) {
    return {};
  }
  const counts = {};
  for (const [name, def] of Object.entries(BON_LANGUAGE_MARKERS)) {
    const matches = text.match(def.pattern);
    if (matches && matches.length > 0) {
      counts[name] = matches.length;
    }
  }
  return counts;
}

// One-shot scan over a concatenated text corpus. Used by bot_analysis.js
// during fetch — output is stored in activityData.{scriptSignals,languageSignals}.
export function bonScanTextSignals(text) {
  return {
    scripts: bonDetectScripts(text),
    languages: bonDetectLanguageMarkers(text),
  };
}

export function bonInferRegionFromScripts(scriptCounts) {
  if (!scriptCounts) {
    return null;
  }
  const votes = {};
  const hits = [];
  for (const [name, count] of Object.entries(scriptCounts)) {
    if (!count) {
      continue;
    }
    const def = BON_SCRIPT_RANGES.find((r) => r.name === name);
    if (!def) {
      continue;
    }
    hits.push({ script: name, count, regions: def.regions });
    // Split votes across plausible regions for ambiguous scripts.
    const share = count / def.regions.length;
    for (const region of def.regions) {
      votes[region] = (votes[region] || 0) + share;
    }
  }
  if (Object.keys(votes).length === 0) {
    return null;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return { region: ranked[0][0], score: ranked[0][1], hits };
}

export function bonInferRegionFromLanguage(languageCounts) {
  if (!languageCounts) {
    return null;
  }
  const votes = {};
  const hits = [];
  for (const [name, count] of Object.entries(languageCounts)) {
    if (!count) {
      continue;
    }
    const def = BON_LANGUAGE_MARKERS[name];
    if (!def) {
      continue;
    }
    hits.push({
      language: name,
      label: def.label,
      count,
      regions: def.regions,
    });
    const share = count / def.regions.length;
    for (const region of def.regions) {
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
export function bonRegionForOffset(offset) {
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

export function bonInferRegionFromModerated(moderatedSubs) {
  if (!Array.isArray(moderatedSubs) || moderatedSubs.length === 0) {
    return null;
  }
  const votes = {};
  const hits = [];
  for (const sub of moderatedSubs) {
    const region = BON_REGION_SUBS[bonNormalizeSubName(sub)];
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

// Combine all deterministic signals (subreddit, script, language, moderator)
// plus timezone, picking the region with the highest weighted score.
// `tzInferred` is the result of reports.js inferTimezoneFromTimestamps().
//
// Returns either:
//   { kind: "deterministic", region, score, subreddit, scriptSignal,
//     languageSignal, moderator, tzOffset, tzMatch, runnerUp }
//   { kind: "timezone-only", offsetHours, possibleRegions }
//   null
export function bonInferRegion(activityData, tzInferred) {
  const subResult = activityData
    ? bonInferRegionFromSubreddits(activityData.subredditCounts)
    : null;
  const scriptResult = activityData
    ? bonInferRegionFromScripts(activityData.scriptSignals)
    : null;
  const langResult = activityData
    ? bonInferRegionFromLanguage(activityData.languageSignals)
    : null;
  const modResult = activityData
    ? bonInferRegionFromModerated(activityData.moderatedSubs)
    : null;
  const tzOffset =
    tzInferred?.kind === "inferred" ? tzInferred.offsetHours : null;

  // Weighted points per source. Calibrated so:
  //  - Moderating a country sub is the single strongest signal (anyone trusted
  //    to mod a region sub is overwhelmingly from that region).
  //  - Subreddit participation, scripts, and language markers are all strong
  //    primary signals; multiple agreeing sources push score sharply higher.
  //  - Timezone is a tie-breaker, never a primary signal — it only bonuses
  //    regions already nominated by something else.
  const scores = {};
  function add(region, points) {
    scores[region] = (scores[region] || 0) + points;
  }
  if (subResult) {
    add(subResult.region, 3 + Math.min(subResult.count - 1, 5));
  }
  if (scriptResult) {
    // 1 point per script char up to 5 bonus, plus 3 base — even 1 Devanagari
    // char is decisive (no organic English text contains it).
    add(scriptResult.region, 3 + Math.min(Math.floor(scriptResult.score), 5));
  }
  if (langResult) {
    add(langResult.region, 3 + Math.min(Math.floor(langResult.score / 2), 5));
  }
  if (modResult) {
    add(modResult.region, 6 + Math.min(modResult.score - 1, 5));
  }
  if (tzOffset != null) {
    for (const region of Object.keys(scores)) {
      const offsets = BON_REGION_INFO[region]?.utcOffsets || [];
      if (offsets.includes(tzOffset)) {
        scores[region] += 1;
      }
    }
  }

  if (Object.keys(scores).length > 0) {
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topRegion, topScore] = ranked[0];
    const tzMatch =
      tzOffset != null
        ? !!BON_REGION_INFO[topRegion]?.utcOffsets?.includes(tzOffset)
        : null;
    return {
      kind: "deterministic",
      region: topRegion,
      score: topScore,
      subreddit: subResult,
      scriptSignal: scriptResult,
      languageSignal: langResult,
      moderator: modResult,
      tzOffset,
      tzMatch,
      runnerUp: ranked[1]
        ? { region: ranked[1][0], score: ranked[1][1] }
        : null,
    };
  }

  if (tzInferred?.kind === "inferred") {
    const possibleRegions = Object.entries(BON_REGION_INFO)
      .filter(([, info]) => info.utcOffsets.includes(tzInferred.offsetHours))
      .map(([code]) => code);
    return {
      kind: "timezone-only",
      offsetHours: tzInferred.offsetHours,
      possibleRegions,
    };
  }
  return null;
}
