// One-time migration: persona archetype renames (May 2026), widened to map
// every archetype key that has ever appeared in stored data to the current
// set:
//   stan    → superfan
//   hustler → shill
//   zealot  → politics
//   crank   → politics    (crank → zealot → politics)
//   thirst  → cam_model
//   teen    → dropped (no current equivalent; a `teen` label demotes to
//             "normal")
//
// The crank/thirst/teen rows come from the deleted crank_to_zealot and
// persona_simplification migrations, which used to run before this one —
// an install old enough to have skipped them can still hold those keys.
// thirst folds in as a straight rename; the deleted migration's
// carry-only-when-hustler-was-high nuance isn't worth reproducing just to
// zero a legacy axis.
//
// Rewrites `persona.archetypes` keys, `persona.label`, and the operator's
// hand-picked `userNotes.ratings`. Idempotent — checks for old keys before
// touching anything.

import { updateReports } from "../storage";
import type { Persona, PersonaLabel, UserNotes } from "../types.ts";

const RENAMES: Record<string, string> = {
  stan: "superfan",
  hustler: "shill",
  zealot: "politics",
  crank: "politics",
  thirst: "cam_model",
};

const DROPPED_KEYS = new Set(["teen"]);

export async function migratePersonaRename2026(): Promise<void> {
  try {
    let renamedAny = false;

    await updateReports((reports) => {
      const next = { ...reports };
      let changed = false;

      for (const [username, report] of Object.entries(reports)) {
        let nextReport = report;
        let touched = false;

        const investigation = nextReport.investigation;
        if (investigation?.status === "done") {
          const persona = investigation.results.persona;
          const rewritten = rewritePersona(persona);
          if (rewritten !== persona) {
            nextReport = {
              ...nextReport,
              investigation: {
                ...investigation,
                results: { ...investigation.results, persona: rewritten },
              },
            };
            touched = true;
          }
        }

        const userNotes = nextReport.userNotes;
        if (userNotes) {
          const rewrittenNotes = rewriteUserNotes(userNotes);
          if (rewrittenNotes !== userNotes) {
            nextReport = { ...nextReport, userNotes: rewrittenNotes };
            touched = true;
          }
        }

        if (touched) {
          next[username] = nextReport;
          changed = true;
        }
      }

      if (!changed) {
        return null;
      }

      renamedAny = true;
      return next;
    });

    if (renamedAny) {
      console.log(
        "[Bot or Not] renamed legacy persona labels to the current archetype set"
      );
    }
  } catch (error) {
    // Rethrow so the runner leaves this migration unrecorded and retries it
    // on the next startup.
    console.error("[Bot or Not] persona rename migration failed", error);
    throw error;
  }
}

function rewritePersona(persona: Persona | null): Persona | null {
  if (!persona) {
    return persona;
  }

  const archetypes = persona.archetypes as Record<string, number> | null;
  const archetypesNeedRename =
    archetypes != null &&
    Object.keys(archetypes).some(
      (key) => key in RENAMES || DROPPED_KEYS.has(key)
    );
  const label = persona.label as string;
  const labelNeedsRename = label in RENAMES || DROPPED_KEYS.has(label);

  if (!archetypesNeedRename && !labelNeedsRename) {
    return persona;
  }

  const nextArchetypes = archetypes
    ? (Object.fromEntries(
        Object.entries(archetypes)
          .filter(([key]) => !DROPPED_KEYS.has(key))
          .map(([key, score]) => [RENAMES[key] ?? key, score])
      ) as typeof persona.archetypes)
    : archetypes;

  const nextLabel = (
    DROPPED_KEYS.has(label) ? "normal" : (RENAMES[label] ?? label)
  ) as PersonaLabel;

  return { ...persona, label: nextLabel, archetypes: nextArchetypes };
}

function rewriteUserNotes(notes: UserNotes): UserNotes {
  const ratings = notes.ratings as readonly string[];
  if (
    !ratings.some((rating) => rating in RENAMES || DROPPED_KEYS.has(rating))
  ) {
    return notes;
  }

  const seen = new Set<string>();
  const next: PersonaLabel[] = [];

  for (const rating of ratings) {
    if (DROPPED_KEYS.has(rating)) {
      continue;
    }

    const remapped = RENAMES[rating] ?? rating;
    if (!seen.has(remapped)) {
      seen.add(remapped);
      next.push(remapped as PersonaLabel);
    }
  }

  return { ...notes, ratings: next };
}
