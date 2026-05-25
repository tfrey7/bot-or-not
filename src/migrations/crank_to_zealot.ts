import { readReports, writeReports } from "../storage.ts";

export async function migrateCrankToZealot(): Promise<void> {
  try {
    const reports = await readReports();

    let changed = false;

    for (const [username, report] of Object.entries(reports)) {
      const investigation = report.investigation;
      if (investigation?.status !== "done") {
        continue;
      }

      const persona = investigation.results.persona;
      if (!persona) {
        continue;
      }

      const archetypes = persona.archetypes as Record<string, number> | null;
      const hasCrankArchetype = archetypes && "crank" in archetypes;
      const hasCrankLabel = (persona.label as string) === "crank";

      if (!hasCrankArchetype && !hasCrankLabel) {
        continue;
      }

      const nextArchetypes = hasCrankArchetype
        ? (() => {
            const { crank, ...rest } = archetypes;
            return { ...rest, zealot: crank } as Record<string, number>;
          })()
        : archetypes;

      reports[username] = {
        ...report,
        investigation: {
          ...investigation,
          results: {
            ...investigation.results,
            persona: {
              ...persona,
              label: hasCrankLabel ? "zealot" : persona.label,
              archetypes: nextArchetypes as typeof persona.archetypes,
            },
          },
        },
      };
      changed = true;
    }

    if (changed) {
      await writeReports(reports);
      console.log("[Bot or Not] migrated crank → zealot in stored personas");
    }
  } catch (error) {
    console.error("[Bot or Not] crank → zealot migration failed", error);
  }
}
