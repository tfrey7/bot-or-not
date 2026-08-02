// Verdict-outcomes card: each verdict band against what Reddit later did
// to those accounts, plus the headline calibration numbers.

import type { Report } from "../../types.ts";
import { formatVerdict } from "../../utils/format_text.ts";
import { ChartCard } from "./chart_card.tsx";
import { StatRows } from "./stat_rows.tsx";
import { analyticsVerdictOutcomes } from "./verdict_outcomes.ts";
import type { VerdictOutcomeRow } from "./verdict_outcomes.ts";

const DAY_MS = 86_400_000;

function pct(rate: number | null): string {
  if (rate === null) {
    return "—";
  }

  return `${Math.round(rate * 100)}%`;
}

function outcomeSummary(row: VerdictOutcomeRow): string {
  if (row.total === 0) {
    return "none";
  }

  const gone = row.suspended + row.deleted;
  return `${row.total} · ${gone} gone (${row.suspended} susp, ${row.deleted} del) · ${pct(row.goneRate)}`;
}

export function VerdictOutcomesCard({
  reports,
}: {
  reports: Array<Report & { username: string }>;
}) {
  const outcomes = analyticsVerdictOutcomes(reports);

  if (outcomes.investigated === 0) {
    return null;
  }

  const survivorDays =
    outcomes.longestSurviving === null
      ? null
      : Math.round((Date.now() - outcomes.longestSurviving.runAt) / DAY_MS);

  return (
    <ChartCard
      title="Verdict outcomes"
      subtitle={`verdict vs. Reddit's own enforcement, ${outcomes.investigated} investigated accounts`}
    >
      <StatRows
        rows={[
          ...outcomes.rows.map((row): [string, string] => [
            formatVerdict(row.verdict),
            outcomeSummary(row),
          ]),
          ["Bot-side gone rate", pct(outcomes.botSideGoneRate)],
          [
            "Control-cohort gone rate",
            outcomes.controlCohort.total === 0
              ? "no cohort members yet"
              : `${pct(outcomes.controlCohort.goneRate)} · ${outcomes.controlCohort.gone} of ${outcomes.controlCohort.known} with status (${outcomes.controlCohort.total} tracked)`,
          ],
          [
            "Longest-surviving bot call",
            outcomes.longestSurviving === null ? (
              "none — every bot call is gone"
            ) : (
              <>
                <span class="bon-pii-name">
                  u/{outcomes.longestSurviving.username}
                </span>
                {` · ${survivorDays} days and counting`}
              </>
            ),
          ],
        ]}
      />
    </ChartCard>
  );
}
