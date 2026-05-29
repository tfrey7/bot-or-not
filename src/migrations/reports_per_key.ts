// Splits the monolithic `reports` blob into one `report:<username>` key per
// record. Operates on raw storage rather than readReports/writeReports
// because it's converting the storage layout those helpers now assume.
// Runs before every other migration so the rest can use the per-key store.

const REPORT_KEY_PREFIX = "report:";
const LEGACY_REPORTS_KEY = "reports";

export async function migrateReportsPerKey(): Promise<void> {
  try {
    const raw = (await browser.storage.local.get(null)) as Record<
      string,
      unknown
    >;

    const legacy = raw[LEGACY_REPORTS_KEY];
    if (!legacy || typeof legacy !== "object") {
      return;
    }

    const batch: Record<string, unknown> = {};

    for (const [username, value] of Object.entries(legacy)) {
      const key = `${REPORT_KEY_PREFIX}${username}`;

      // A per-key write that raced the migration (e.g. an orphan sweep that
      // re-ran an investigation) is fresher than the blob — leave it.
      if (key in raw) {
        continue;
      }

      batch[key] = value;
    }

    if (Object.keys(batch).length > 0) {
      await browser.storage.local.set(batch);
    }

    await browser.storage.local.remove(LEGACY_REPORTS_KEY);
    console.log(
      `[Bot or Not] migrated ${Object.keys(legacy).length} reports to per-key storage`
    );
  } catch (error) {
    console.error("[Bot or Not] reports per-key migration failed", error);
  }
}
