import { migratePersonaRename2026 } from "./persona_rename_2026.ts";
import { migrateReportsPerKey } from "./reports_per_key.ts";

// One-time data migrations, run at background startup in listed order. Each
// completed key is recorded in `migrationsRun` so later startups skip the
// full-store scans the migrations pay. A migration that throws stays
// unrecorded and retries on the next startup; the ones after it still run —
// every migration is independently idempotent. Remove an entry (and its
// file) once no installed copy could still carry the older data.
const MIGRATIONS: Array<{ key: string; run: () => Promise<void> }> = [
  { key: "reports_per_key", run: migrateReportsPerKey },
  { key: "persona_rename_2026", run: migratePersonaRename2026 },
];

export async function runMigrations(): Promise<void> {
  const raw = (await browser.storage.local.get("migrationsRun")) as {
    migrationsRun?: unknown;
  };
  const done = new Set<string>(
    Array.isArray(raw.migrationsRun)
      ? raw.migrationsRun.filter(
          (key): key is string => typeof key === "string"
        )
      : []
  );

  for (const migration of MIGRATIONS) {
    if (done.has(migration.key)) {
      continue;
    }

    try {
      await migration.run();
      done.add(migration.key);
      await browser.storage.local.set({ migrationsRun: [...done] });
    } catch (error) {
      console.error(`[Bot or Not] migration ${migration.key} failed`, error);
    }
  }
}
