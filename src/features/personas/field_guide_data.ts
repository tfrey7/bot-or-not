// Editorial copy for the persona field guide. Keyed by archetype; only the
// personas with an entry here render, so the guide can grow one persona at a
// time. The blurb in factors.ts stays the canonical one-liner (it drives the
// archetype grid) — these are the longer field-guide treatments.

import type { ArchetypeKey } from "../../types.ts";

export interface FieldGuideEntry {
  epigraph: string;

  // body's first letter renders as a drop cap.
  body: string;

  tells: readonly string[];

  // Subreddits where the persona congregates, bare names (no "r/" prefix).
  subreddits: readonly string[];

  // Representative posts/comments — the persona "in their own words".
  samples: readonly string[];
}

export const FIELD_GUIDE_ENTRIES: Partial<
  Record<ArchetypeKey, FieldGuideEntry>
> = {
  politics: {
    epigraph: "The single-issue political combatant.",
    body: "To this account, Reddit is not a forum but a front line. Every thread is terrain to be held, every headline fresh ammunition. They post with the stamina of a true believer — daily, relentlessly, and always in the service of the one cause that organizes the whole account. Nuance reads as weakness; disagreement, as enemy action.",
    tells: [
      "Activity clusters in a handful of political subs, rarely anything else.",
      "Comments run to outrage and moral certainty — allies and enemies, little in between.",
      "Every news item gets folded into evidence for the cause.",
      "High volume, low variety: the same arguments, recycled.",
    ],
    subreddits: [
      "politics",
      "PoliticalDiscussion",
      "news",
      "worldnews",
      "Conservative",
      "PoliticalHumor",
    ],
    samples: [
      "Cute that you think \"both sides\" is a take. One side is openly telling you what they'll do and you're worried about tone. Read the bill, then come back.",
      "Saved this thread. Screenshotting every one of you so when it plays out exactly like we've been warning for years, there's a receipt. RemindMe! 6 months.",
    ],
  },
};
