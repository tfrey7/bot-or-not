// One-time migration: persona archetype renames (May 2026).
//
// Pure key/label renames — no scope or scoring change:
//   stan    → superfan
//   hustler → shill
//   zealot  → politics
//
// Rewrites `persona.archetypes` keys, `persona.label`, and the operator's
// hand-picked `userNotes.ratings`. Idempotent — checks for old keys before
// touching anything. Runs after crank_to_zealot and persona_simplification
// so it catches the keys those migrations produce.

import { readReports, writeReports } from "../storage.ts";
import type { Persona, PersonaLabel, UserNotes } from "../types.ts";

const RENAMES: Record<string, string> = {
  stan: "superfan",
  hustler: "shill",
  zealot: "politics",
};

export async function migratePersonaRename2026(): Promise<void> {
  try {
    const reports = await readReports();
    let changed = false;

    for (const [username, report] of Object.entries(reports)) {
      let next = report;
      let touched = false;

      const investigation = next.investigation;
      if (investigation?.status === "done") {
        const persona = investigation.results.persona;
        const rewritten = rewritePersona(persona);
        if (rewritten !== persona) {
          next = {
            ...next,
            investigation: {
              ...investigation,
              results: { ...investigation.results, persona: rewritten },
            },
          };
          touched = true;
        }
      }

      const userNotes = next.userNotes;
      if (userNotes) {
        const rewrittenNotes = rewriteUserNotes(userNotes);
        if (rewrittenNotes !== userNotes) {
          next = { ...next, userNotes: rewrittenNotes };
          touched = true;
        }
      }

      if (touched) {
        reports[username] = next;
        changed = true;
      }
    }

    if (changed) {
      await writeReports(reports);
      console.log(
        "[Bot or Not] renamed personas: stan → superfan, hustler → shill, zealot → politics"
      );
    }
  } catch (error) {
    console.error("[Bot or Not] persona rename migration failed", error);
  }
}

function rewritePersona(persona: Persona | null): Persona | null {
  if (!persona) {
    return persona;
  }

  const archetypes = persona.archetypes as Record<string, number> | null;
  const archetypesNeedRename =
    archetypes != null && Object.keys(archetypes).some((key) => key in RENAMES);
  const labelNeedsRename = (persona.label as string) in RENAMES;

  if (!archetypesNeedRename && !labelNeedsRename) {
    return persona;
  }

  const nextArchetypes = archetypes
    ? (Object.fromEntries(
        Object.entries(archetypes).map(([key, score]) => [
          RENAMES[key] ?? key,
          score,
        ])
      ) as typeof persona.archetypes)
    : archetypes;

  const nextLabel = (RENAMES[persona.label as string] ??
    persona.label) as PersonaLabel;

  return { ...persona, label: nextLabel, archetypes: nextArchetypes };
}

function rewriteUserNotes(notes: UserNotes): UserNotes {
  const ratings = notes.ratings as readonly string[];
  if (!ratings.some((rating) => rating in RENAMES)) {
    return notes;
  }

  const seen = new Set<string>();
  const next: PersonaLabel[] = [];

  for (const rating of ratings) {
    const remapped = RENAMES[rating] ?? rating;
    if (!seen.has(remapped)) {
      seen.add(remapped);
      next.push(remapped as PersonaLabel);
    }
  }

  return { ...notes, ratings: next };
}
