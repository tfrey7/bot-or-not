import { migrateApiKeysPerVendor } from "./api_keys_per_vendor.ts";
import { migrateCrankToZealot } from "./crank_to_zealot.ts";
import { migrateGoogleHarvestAttribution } from "./google_harvest_attribution.ts";
import { migratePersonaSimplification } from "./persona_simplification.ts";
import { migrateUserNotesRatings } from "./user_notes_ratings.ts";

// One-time data migrations. Each function rewrites stored reports from an
// older shape into the current one. Safe to remove once no installed copy
// could still be carrying the older data.
export async function runMigrations(): Promise<void> {
  await migrateCrankToZealot();
  await migrateGoogleHarvestAttribution();
  await migrateUserNotesRatings();
  await migratePersonaSimplification();
  await migrateApiKeysPerVendor();
}
