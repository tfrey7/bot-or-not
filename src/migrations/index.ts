import { migratePersonaRename2026 } from "./persona_rename_2026.ts";

// One-time data migrations. Each function rewrites stored reports from an
// older shape into the current one. Safe to remove once no installed copy
// could still be carrying the older data.
export async function runMigrations(): Promise<void> {
  await migratePersonaRename2026();
}
