import { bonMigrateCrankToZealot } from "./crank_to_zealot.ts";
import { bonMigrateGoogleHarvestAttribution } from "./google_harvest_attribution.ts";
import { bonMigratePersonaSimplification } from "./persona_simplification.ts";
import { bonMigrateUserNotesRatings } from "./user_notes_ratings.ts";

// One-time data migrations. Each function rewrites stored reports from an
// older shape into the current one. Safe to remove once no installed copy
// could still be carrying the older data.
export async function bonRunMigrations(): Promise<void> {
  await bonMigrateCrankToZealot();
  await bonMigrateGoogleHarvestAttribution();
  await bonMigrateUserNotesRatings();
  await bonMigratePersonaSimplification();
}
