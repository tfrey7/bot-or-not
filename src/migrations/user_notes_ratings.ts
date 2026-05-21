import { bonReadReports, bonWriteReports } from "../storage.ts";

// Rewrite legacy `userNotes.rating` (single label) into `userNotes.ratings`
// (array) so the multi-pick picker has a consistent shape to read from.
// The canonicalizer accepts either form, so this migration is about
// keeping stored data clean — not about correctness at read time.
export async function bonMigrateUserNotesRatings(): Promise<void> {
  try {
    const reports = await bonReadReports();

    let changed = false;

    for (const [username, report] of Object.entries(reports)) {
      const userNotes = report.userNotes as unknown;
      if (!userNotes || typeof userNotes !== "object") {
        continue;
      }

      const record = userNotes as Record<string, unknown>;
      if (Array.isArray(record.ratings)) {
        continue;
      }

      const rawRating = record.rating;
      const ratings =
        typeof rawRating === "string" && rawRating ? [rawRating] : [];

      const { rating: _drop, ...rest } = record;
      reports[username] = {
        ...report,
        userNotes: { ...rest, ratings } as typeof report.userNotes,
      };
      changed = true;
    }

    if (changed) {
      await bonWriteReports(reports);
      console.log("[Bot or Not] migrated userNotes.rating → ratings[]");
    }
  } catch (error) {
    console.error("[Bot or Not] userNotes ratings migration failed", error);
  }
}
