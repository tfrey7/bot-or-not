import { bonMigrateCrankToZealot } from "./crank_to_zealot.ts";

// One-time data migrations. Each function rewrites stored reports from an
// older shape into the current one. Safe to remove once no installed copy
// could still be carrying the older data.
export async function bonRunMigrations(): Promise<void> {
  await bonMigrateCrankToZealot();
}
