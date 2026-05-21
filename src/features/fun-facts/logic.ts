// Fun-facts computation. Pure — takes the same report rows the rest of the
// page already has and surfaces rarity/extreme observations across the
// corpus. Each picker returns at most one Fact (or null when there isn't
// enough signal). The orchestrator stitches them into a grid.
//
// Most pickers work off completed investigations only (status === "done"),
// because the interesting fields — verdict, persona, region, accountAgeDays
// — are null until then. Top-level Report fields like totalKarma and
// userStatus can be present without an investigation, so a couple of
// pickers (karma king) fall back to those.

import { BON_ARCHETYPES } from "../../factors.ts";
import type {
  ArchetypeKey,
  Investigation,
  Report,
  Verdict,
} from "../../types.ts";
import { bonPersonaHue } from "../../utils/persona_color.ts";
import {
  bonPersonaComboKey,
  bonPersonaTitle,
} from "../../utils/persona_title.ts";
import { BON_REGION_INFO } from "../regions/data.ts";

export type BonFunFactsReportRow = Report & { username: string };

export interface BonFunFact {
  kind: string;
  title: string;
  highlight: string;
  username: string | null;
  detail: string;
  badge: string | null;
  hue: number | null;
}

interface BonFunFactsDoneEntry {
  username: string;
  investigation: Investigation;
  report: BonFunFactsReportRow;
}

const ARCHETYPE_LABELS = Object.fromEntries(
  BON_ARCHETYPES.map((archetype) => [archetype.key, archetype.label])
) as Record<ArchetypeKey, string>;

const ARCHETYPE_HUES = Object.fromEntries(
  BON_ARCHETYPES.map((archetype) => [archetype.key, archetype.hue])
) as Record<ArchetypeKey, number>;

const VERDICT_HUE_BOT = 12;
const VERDICT_HUE_HUMAN = 145;

export function bonFunFactsCompute(
  reports: BonFunFactsReportRow[]
): BonFunFact[] {
  const done = bonFunFactsCollectDone(reports);
  const facts: BonFunFact[] = [];

  const rarestCountry = bonFunFactsPickRarestCountry(done);
  if (rarestCountry) {
    facts.push(rarestCountry);
  }

  const rarestPersona = bonFunFactsPickRarestPersona(done);
  if (rarestPersona) {
    facts.push(rarestPersona);
  }

  const rareCombo = bonFunFactsPickRareCombo(done);
  if (rareCombo) {
    facts.push(rareCombo);
  }

  const oldest = bonFunFactsPickOldestAccount(done);
  if (oldest) {
    facts.push(oldest);
  }

  const karma = bonFunFactsPickKarmaKing(reports);
  if (karma) {
    facts.push(karma);
  }

  const decisiveBot = bonFunFactsPickMostDecisive(done, "bot");
  if (decisiveBot) {
    facts.push(decisiveBot);
  }

  const decisiveHuman = bonFunFactsPickMostDecisive(done, "human");
  if (decisiveHuman) {
    facts.push(decisiveHuman);
  }

  const archetype = bonFunFactsPickStrongestArchetype(done);
  if (archetype) {
    facts.push(archetype);
  }

  return facts;
}

function bonFunFactsCollectDone(
  reports: BonFunFactsReportRow[]
): BonFunFactsDoneEntry[] {
  const out: BonFunFactsDoneEntry[] = [];

  for (const report of reports) {
    const investigation = report.investigation;
    if (investigation && investigation.status === "done") {
      out.push({
        username: report.username,
        investigation,
        report,
      });
    }
  }

  return out;
}

function bonFunFactsPickRarestCountry(
  done: BonFunFactsDoneEntry[]
): BonFunFact | null {
  const byRegion = new Map<string, BonFunFactsDoneEntry[]>();

  for (const entry of done) {
    const code = entry.investigation.region?.code;
    if (!code) {
      continue;
    }

    const info = BON_REGION_INFO[code];
    if (!info) {
      continue;
    }

    const existing = byRegion.get(code);
    if (existing) {
      existing.push(entry);
    } else {
      byRegion.set(code, [entry]);
    }
  }

  if (byRegion.size === 0) {
    return null;
  }

  let bestRegion: string | null = null;
  let bestCount = Infinity;
  let bestMostRecent = -Infinity;

  for (const [region, entries] of byRegion) {
    const count = entries.length;
    const mostRecent = bonFunFactsMaxRunAt(entries);

    if (
      count < bestCount ||
      (count === bestCount && mostRecent > bestMostRecent)
    ) {
      bestRegion = region;
      bestCount = count;
      bestMostRecent = mostRecent;
    }
  }

  if (!bestRegion) {
    return null;
  }

  const entries = byRegion.get(bestRegion)!;
  const info = BON_REGION_INFO[bestRegion]!;
  const subject = bonFunFactsMostRecent(entries);
  const detail =
    bestCount === 1
      ? `The only ${info.label} account in your corpus so far.`
      : `One of ${bestCount} ${info.label} accounts — your rarest country.`;

  return {
    kind: "rarest-country",
    title: "Rarest country",
    highlight: `${info.flag} ${info.label}`,
    username: subject.username,
    detail,
    badge: bestCount === 1 ? "1 of 1" : `1 of ${bestCount}`,
    hue: null,
  };
}

function bonFunFactsPickRarestPersona(
  done: BonFunFactsDoneEntry[]
): BonFunFact | null {
  const byLabel = new Map<string, BonFunFactsDoneEntry[]>();

  for (const entry of done) {
    const label = entry.investigation.persona?.label;
    if (!label) {
      continue;
    }

    const existing = byLabel.get(label);
    if (existing) {
      existing.push(entry);
    } else {
      byLabel.set(label, [entry]);
    }
  }

  if (byLabel.size === 0) {
    return null;
  }

  let bestLabel: string | null = null;
  let bestCount = Infinity;
  let bestMostRecent = -Infinity;

  for (const [label, entries] of byLabel) {
    const count = entries.length;
    const mostRecent = bonFunFactsMaxRunAt(entries);

    if (
      count < bestCount ||
      (count === bestCount && mostRecent > bestMostRecent)
    ) {
      bestLabel = label;
      bestCount = count;
      bestMostRecent = mostRecent;
    }
  }

  if (!bestLabel) {
    return null;
  }

  const entries = byLabel.get(bestLabel)!;
  const subject = bonFunFactsMostRecent(entries);
  const persona = subject.investigation.persona!;
  const title = bonPersonaTitle(persona);

  return {
    kind: "rarest-persona",
    title: "Rarest persona",
    highlight: title,
    username: subject.username,
    detail:
      bestCount === 1
        ? `The only ${title} in your data — every other account leans elsewhere.`
        : `One of just ${bestCount} ${title}s you've flagged.`,
    badge: bestCount === 1 ? "1 of 1" : `1 of ${bestCount}`,
    hue: bonPersonaHue(persona),
  };
}

function bonFunFactsPickRareCombo(
  done: BonFunFactsDoneEntry[]
): BonFunFact | null {
  const byCombo = new Map<string, BonFunFactsDoneEntry[]>();

  for (const entry of done) {
    const persona = entry.investigation.persona;
    if (!persona) {
      continue;
    }

    const comboKey = bonPersonaComboKey(persona);
    if (!comboKey) {
      continue;
    }

    const existing = byCombo.get(comboKey);
    if (existing) {
      existing.push(entry);
    } else {
      byCombo.set(comboKey, [entry]);
    }
  }

  if (byCombo.size === 0) {
    return null;
  }

  let bestCombo: string | null = null;
  let bestCount = Infinity;
  let bestMostRecent = -Infinity;

  for (const [combo, entries] of byCombo) {
    const count = entries.length;
    const mostRecent = bonFunFactsMaxRunAt(entries);

    if (
      count < bestCount ||
      (count === bestCount && mostRecent > bestMostRecent)
    ) {
      bestCombo = combo;
      bestCount = count;
      bestMostRecent = mostRecent;
    }
  }

  if (!bestCombo) {
    return null;
  }

  const entries = byCombo.get(bestCombo)!;
  const subject = bonFunFactsMostRecent(entries);
  const title = bonPersonaTitle(subject.investigation.persona!);

  return {
    kind: "rare-combo",
    title: "Rare archetype combo",
    highlight: title,
    username: subject.username,
    detail:
      bestCount === 1
        ? `The only ${title} blend you've seen — both archetypes balanced at the threshold.`
        : `One of ${bestCount} ${title} blends in your corpus.`,
    badge: bestCount === 1 ? "only blend" : `1 of ${bestCount}`,
    hue: bonPersonaHue(subject.investigation.persona!),
  };
}

function bonFunFactsPickOldestAccount(
  done: BonFunFactsDoneEntry[]
): BonFunFact | null {
  let best: BonFunFactsDoneEntry | null = null;
  let bestAge = -Infinity;

  for (const entry of done) {
    const age = entry.investigation.accountAgeDays;
    if (age == null) {
      continue;
    }

    if (age > bestAge) {
      best = entry;
      bestAge = age;
    }
  }

  if (!best) {
    return null;
  }

  const years = bestAge / 365.25;
  const created = best.investigation.accountCreatedAt;
  const createdLabel = bonFunFactsFormatIsoDate(created);

  return {
    kind: "oldest-account",
    title: "Oldest account",
    highlight: `${years.toFixed(1)}y on Reddit`,
    username: best.username,
    detail: createdLabel
      ? `Created ${createdLabel} — the longest-tenured account you've flagged.`
      : `The longest-tenured account you've flagged.`,
    badge: null,
    hue: null,
  };
}

function bonFunFactsPickKarmaKing(
  reports: BonFunFactsReportRow[]
): BonFunFact | null {
  let best: BonFunFactsReportRow | null = null;
  let bestKarma = -Infinity;

  for (const report of reports) {
    const karma = report.totalKarma;
    if (karma == null) {
      continue;
    }

    if (karma > bestKarma) {
      best = report;
      bestKarma = karma;
    }
  }

  if (!best || bestKarma <= 0) {
    return null;
  }

  return {
    kind: "karma-king",
    title: "Karma king",
    highlight: bonFunFactsFormatKarma(bestKarma),
    username: best.username,
    detail: `Most total karma across every reported user — ${bestKarma.toLocaleString()} points.`,
    badge: null,
    hue: null,
  };
}

function bonFunFactsPickMostDecisive(
  done: BonFunFactsDoneEntry[],
  side: "bot" | "human"
): BonFunFact | null {
  let best: BonFunFactsDoneEntry | null = null;
  let bestProb = side === "bot" ? -Infinity : Infinity;

  for (const entry of done) {
    const prob = entry.investigation.botProbability;
    if (prob == null) {
      continue;
    }

    if (side === "bot" ? prob > bestProb : prob < bestProb) {
      best = entry;
      bestProb = prob;
    }
  }

  if (!best) {
    return null;
  }

  const verdict = best.investigation.verdict;
  const verdictLabel = verdict ? bonFunFactsVerdictLabel(verdict) : null;
  const pct = Math.round(bestProb * 100);

  if (side === "bot") {
    return {
      kind: "most-decisive-bot",
      title: "Most decisive bot call",
      highlight: `${pct}% bot`,
      username: best.username,
      detail: verdictLabel
        ? `Top bot probability in your data · verdict ${verdictLabel}.`
        : `Top bot probability in your data.`,
      badge: null,
      hue: VERDICT_HUE_BOT,
    };
  }

  return {
    kind: "most-decisive-human",
    title: "Most decisive human call",
    highlight: `${pct}% bot`,
    username: best.username,
    detail: verdictLabel
      ? `Lowest bot probability in your data · verdict ${verdictLabel}.`
      : `Lowest bot probability in your data.`,
    badge: null,
    hue: VERDICT_HUE_HUMAN,
  };
}

function bonFunFactsPickStrongestArchetype(
  done: BonFunFactsDoneEntry[]
): BonFunFact | null {
  let best: BonFunFactsDoneEntry | null = null;
  let bestKey: ArchetypeKey | null = null;
  let bestScore = -Infinity;

  for (const entry of done) {
    const archetypes = entry.investigation.persona?.archetypes;
    if (!archetypes) {
      continue;
    }

    for (const archetype of BON_ARCHETYPES) {
      const score = archetypes[archetype.key];
      if (typeof score !== "number") {
        continue;
      }

      if (score > bestScore) {
        best = entry;
        bestKey = archetype.key;
        bestScore = score;
      }
    }
  }

  if (!best || !bestKey || bestScore <= 0) {
    return null;
  }

  const label = ARCHETYPE_LABELS[bestKey];

  return {
    kind: "strongest-archetype",
    title: "Strongest archetype",
    highlight: label,
    username: best.username,
    detail: `Scores ${bestScore.toFixed(2)} on the ${label.toLowerCase()} axis — your purest ${label.toLowerCase()}.`,
    badge: bestScore.toFixed(2),
    hue: ARCHETYPE_HUES[bestKey],
  };
}

function bonFunFactsMaxRunAt(entries: BonFunFactsDoneEntry[]): number {
  let max = -Infinity;

  for (const entry of entries) {
    const runAt = entry.investigation.runAt ?? 0;
    if (runAt > max) {
      max = runAt;
    }
  }

  return max;
}

function bonFunFactsMostRecent(
  entries: BonFunFactsDoneEntry[]
): BonFunFactsDoneEntry {
  let best = entries[0]!;
  let bestRun = best.investigation.runAt ?? 0;

  for (const entry of entries) {
    const run = entry.investigation.runAt ?? 0;
    if (run > bestRun) {
      best = entry;
      bestRun = run;
    }
  }

  return best;
}

function bonFunFactsFormatIsoDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function bonFunFactsFormatKarma(karma: number): string {
  if (karma >= 1_000_000) {
    return `${(karma / 1_000_000).toFixed(1)}M karma`;
  }

  if (karma >= 10_000) {
    return `${(karma / 1_000).toFixed(0)}k karma`;
  }

  if (karma >= 1_000) {
    return `${(karma / 1_000).toFixed(1)}k karma`;
  }

  return `${karma} karma`;
}

function bonFunFactsVerdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "bot":
      return "Bot";
    case "likely-bot":
      return "Likely bot";
    case "uncertain":
      return "Uncertain";
    case "likely-human":
      return "Likely human";
    case "human":
      return "Human";
  }
}
