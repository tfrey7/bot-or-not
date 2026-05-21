// One-time migration: persona taxonomy simplification (May 2026).
//
// Removes the `teen` archetype (age moves to a separate demographics block,
// populated by future investigations only — old records get no backfill).
// Renames `thirst` → `cam_model` with a tightened scope: the new archetype
// is the OF/cam-funnel pattern only, not the "normal Redditor with a selfie
// habit" reading the old `thirst` axis covered.
//
// Strategy:
// - `archetypes.teen` is dropped outright.
// - `archetypes.thirst` is rewritten conditionally — copy the old value to
//   `cam_model` only when `archetypes.hustler ≥ 0.4` (the OF/cam shape was
//   always thirst+hustler together). Otherwise zero out — the old "selfie
//   habit" reading isn't what `cam_model` means now.
// - `persona.label` of "teen" demotes to the next-strongest archetype
//   ≥ 0.4, else "normal".
// - `persona.label` of "thirst" → "cam_model" when hustler was high enough
//   for the archetype rename to fire, else demotes the same way.
// - `userNotes.ratings`: drops "teen" entries; renames "thirst" → "cam_model"
//   straight (user picks are deliberate, no conditional rewrite).
//
// Idempotent — checks for old keys before touching anything.

import { bonReadReports, bonWriteReports } from "../storage.ts";
import type {
  ArchetypeKey,
  Persona,
  PersonaLabel,
  UserNotes,
} from "../types.ts";

const HUSTLER_THRESHOLD_FOR_CAM_MODEL = 0.4;
const LABEL_DEMOTION_THRESHOLD = 0.4;

export async function bonMigratePersonaSimplification(): Promise<void> {
  try {
    const reports = await bonReadReports();
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
              results: {
                ...investigation.results,
                persona: rewritten,
              },
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
      await bonWriteReports(reports);
      console.log(
        "[Bot or Not] migrated personas: dropped teen, narrowed thirst → cam_model"
      );
    }
  } catch (error) {
    console.error(
      "[Bot or Not] persona simplification migration failed",
      error
    );
  }
}

function rewritePersona(persona: Persona | null): Persona | null {
  if (!persona) {
    return persona;
  }

  const archetypes = persona.archetypes as Record<string, number> | null;
  const hasTeen = archetypes != null && "teen" in archetypes;
  const hasThirst = archetypes != null && "thirst" in archetypes;
  const labelIsTeen = (persona.label as string) === "teen";
  const labelIsThirst = (persona.label as string) === "thirst";

  if (!hasTeen && !hasThirst && !labelIsTeen && !labelIsThirst) {
    return persona;
  }

  // Rewrite archetypes map. We rebuild from scratch so the result has only
  // the current key set — no `teen`, no `thirst`, plus the new `cam_model`.
  const nextArchetypes: Record<ArchetypeKey, number> | null = archetypes
    ? rewriteArchetypes(archetypes)
    : null;

  // Rewrite label.
  let nextLabel: PersonaLabel = persona.label;
  if (labelIsTeen) {
    nextLabel = pickDemotion(nextArchetypes);
  } else if (labelIsThirst) {
    // If thirst → cam_model carried meaningful score, the label follows it.
    // Otherwise demote like any other dropped label.
    const camScore = nextArchetypes?.cam_model ?? 0;
    nextLabel =
      camScore >= LABEL_DEMOTION_THRESHOLD
        ? "cam_model"
        : pickDemotion(nextArchetypes);
  }

  return {
    ...persona,
    label: nextLabel,
    archetypes: nextArchetypes,
  };
}

function rewriteArchetypes(
  archetypes: Record<string, number>
): Record<ArchetypeKey, number> {
  const hustler = numberOrZero(archetypes.hustler);
  const thirst = numberOrZero(archetypes.thirst);

  // Conditional cam_model: keep the old thirst score only when paired with
  // a meaningful hustler score (the OF/cam shape). Otherwise drop — the
  // "normal Redditor with selfie habit" reading isn't cam_model.
  const camModel = hustler >= HUSTLER_THRESHOLD_FOR_CAM_MODEL ? thirst : 0;

  return {
    stan: numberOrZero(archetypes.stan),
    farmer: numberOrZero(archetypes.farmer),
    cam_model: camModel,
    zealot: numberOrZero(archetypes.zealot),
    hustler,
    doomer: numberOrZero(archetypes.doomer),
  };
}

function pickDemotion(
  archetypes: Record<ArchetypeKey, number> | null
): PersonaLabel {
  if (!archetypes) {
    return "normal";
  }

  let topKey: ArchetypeKey | null = null;
  let topScore = -Infinity;

  for (const [key, score] of Object.entries(archetypes) as Array<
    [ArchetypeKey, number]
  >) {
    if (score > topScore) {
      topKey = key;
      topScore = score;
    }
  }

  if (topKey && topScore >= LABEL_DEMOTION_THRESHOLD) {
    return topKey;
  }

  return "normal";
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  return 0;
}

function rewriteUserNotes(notes: UserNotes): UserNotes {
  const ratings = notes.ratings as readonly string[];
  const hasTeen = ratings.includes("teen");
  const hasThirst = ratings.includes("thirst");

  if (!hasTeen && !hasThirst) {
    return notes;
  }

  const seen = new Set<string>();
  const next: PersonaLabel[] = [];

  for (const rating of ratings) {
    if (rating === "teen") {
      continue;
    }

    const remapped = rating === "thirst" ? "cam_model" : rating;
    if (!seen.has(remapped)) {
      seen.add(remapped);
      next.push(remapped as PersonaLabel);
    }
  }

  return { ...notes, ratings: next };
}
