// Outcome analysis over an exported backup: how our verdicts line up with
// what Reddit later did to each account — suspended (sitewide ban, the
// strongest confirmation we were right), deleted (ambiguous: self-deletion
// looks identical), or still active. No network, no Claude calls.
//
//   npm run outcomes                          — newest ~/Downloads/bot-or-not-backup-*.json
//   npm run outcomes -- path/to/backup.json

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { FACTORS } from "../src/factors.ts";
import type { InvestigationResults, Report } from "../src/types.ts";
import { investigationResults, normalizeReport } from "../src/utils/history.ts";
import { isSuspectedBot, normalizeInvestigation } from "../src/verdict.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface AnalyzedReport {
  username: string;
  report: Report;
  results: InvestigationResults;
}

function findNewestBackup(): string {
  const downloads = join(homedir(), "Downloads");
  const candidates = readdirSync(downloads)
    .filter(
      (name) => name.startsWith("bot-or-not-backup-") && name.endsWith(".json")
    )
    .sort()
    .reverse();

  if (candidates.length === 0) {
    console.error(
      "No bot-or-not-backup-*.json in ~/Downloads. Export one from the reports page's sync card, or pass a path."
    );
    process.exit(1);
  }

  return join(downloads, candidates[0]);
}

const backupPath = process.argv[2] ?? findNewestBackup();
const backup = JSON.parse(readFileSync(backupPath, "utf8")) as {
  bonBackup?: number;
  exportedAt?: number;
  reports?: Record<string, unknown>;
};

if (!backup.bonBackup || !backup.reports) {
  console.error(`Not a Bot or Not backup: ${backupPath}`);
  process.exit(1);
}

// All age math is relative to export time, not now — the statuses in the
// file are only as fresh as the export.
const exportedAt = backup.exportedAt || Date.now();

const analyzed: AnalyzedReport[] = [];
let totalReports = 0;

for (const [username, rawReport] of Object.entries(backup.reports)) {
  totalReports++;
  const report = normalizeReport(rawReport);
  const investigation = normalizeInvestigation(
    report.investigation,
    report.ringId !== null
  );
  const results = investigationResults(investigation);

  if (results) {
    analyzed.push({ username, report, results });
  }
}

const VERDICT_ORDER = [
  "bot",
  "likely-bot",
  "uncertain",
  "likely-human",
  "human",
] as const;
const STATUS_ORDER = ["suspended", "deleted", "active", "unknown"] as const;

type StatusKey = (typeof STATUS_ORDER)[number];

function statusOf(report: Report): StatusKey {
  return report.userStatus ?? "unknown";
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—";
  }

  return `${Math.round((100 * numerator) / denominator)}%`;
}

function daysAgo(timestamp: number): number {
  return Math.round((exportedAt - timestamp) / DAY_MS);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[column])
      )
      .join("  ");

  console.log(line(headers));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) {
    console.log(line(row));
  }
}

console.log(`backup: ${backupPath}`);
console.log(
  `exported: ${new Date(exportedAt).toISOString().slice(0, 10)} — ${totalReports} reports, ${analyzed.length} completed investigations\n`
);

// --- Verdict × account status ---

console.log("## Verdict × account status\n");
printTable(
  ["verdict", ...STATUS_ORDER, "gone rate*"],
  VERDICT_ORDER.map((verdict) => {
    const group = analyzed.filter((entry) => entry.results.verdict === verdict);
    const counts = STATUS_ORDER.map(
      (status) =>
        group.filter((entry) => statusOf(entry.report) === status).length
    );
    const known = counts[0] + counts[1] + counts[2];

    return [verdict, ...counts.map(String), pct(counts[0] + counts[1], known)];
  })
);
console.log(
  "* gone = suspended + deleted, as a share of status-known accounts.\n" +
    "  Only suspected bots get the weekly liveness re-check; human-verdict\n" +
    "  rows update only when you happen to browse the profile, so their\n" +
    "  suspended/deleted counts are undercounts.\n"
);

const suspectedBots = analyzed.filter((entry) =>
  isSuspectedBot(entry.results.verdict)
);
const withStatus = suspectedBots.filter(
  (entry) => statusOf(entry.report) !== "unknown"
);

// --- Status freshness ---

const neverChecked = suspectedBots.filter(
  (entry) => entry.report.userStatusCheckedAt === 0
).length;
const staleness = suspectedBots
  .filter((entry) => entry.report.userStatusCheckedAt > 0)
  .map((entry) => daysAgo(entry.report.userStatusCheckedAt))
  .sort((a, b) => a - b);
const medianStaleness =
  staleness.length > 0 ? staleness[Math.floor(staleness.length / 2)] : null;

console.log(
  `Suspected bots: ${suspectedBots.length} (${withStatus.length} with a resolved status, ` +
    `${neverChecked} never checked, median check age ${medianStaleness ?? "—"}d at export)\n`
);

// --- Confirmation by bot probability ---

console.log("## Gone rate by bot probability (all verdicts, status known)\n");
const probabilityBuckets = [0, 0.2, 0.4, 0.6, 0.8];
printTable(
  ["bucket", "accounts", "suspended", "deleted", "gone rate"],
  probabilityBuckets.map((low) => {
    const high = low + 0.2;
    const group = analyzed.filter((entry) => {
      const probability = entry.results.botProbability;
      const inBucket =
        probability >= low &&
        (high === 1 ? probability <= 1 : probability < high);

      return inBucket && statusOf(entry.report) !== "unknown";
    });
    const suspended = group.filter(
      (entry) => statusOf(entry.report) === "suspended"
    ).length;
    const deleted = group.filter(
      (entry) => statusOf(entry.report) === "deleted"
    ).length;

    return [
      `${low.toFixed(1)}–${high.toFixed(1)}`,
      String(group.length),
      String(suspended),
      String(deleted),
      pct(suspended + deleted, group.length),
    ];
  })
);
console.log("");

// --- Survival by verdict age ---

console.log("## Suspected bots by verdict age (status known)\n");
const ageBuckets: Array<[string, number, number]> = [
  ["< 30d", 0, 30],
  ["30–90d", 30, 90],
  ["90–180d", 90, 180],
  ["> 180d", 180, Infinity],
];
printTable(
  ["verdict age", "accounts", "suspended", "deleted", "still active"],
  ageBuckets.map(([label, low, high]) => {
    const group = withStatus.filter((entry) => {
      const age = daysAgo(entry.results.runAt);

      return age >= low && age < high;
    });
    const suspended = group.filter(
      (entry) => statusOf(entry.report) === "suspended"
    ).length;
    const deleted = group.filter(
      (entry) => statusOf(entry.report) === "deleted"
    ).length;
    const active = group.length - suspended - deleted;

    return [
      label,
      String(group.length),
      String(suspended),
      String(deleted),
      `${active} (${pct(active, group.length)})`,
    ];
  })
);
console.log("");

// --- Factor forensics: suspended vs surviving ---
// "Confirmed" is suspended-only. Deleted is excluded — a human who
// self-deleted looks identical to a purged bot.

const confirmed = withStatus.filter(
  (entry) => statusOf(entry.report) === "suspended"
);
const surviving = withStatus.filter(
  (entry) => statusOf(entry.report) === "active"
);

function meanBotwardContribution(
  group: AnalyzedReport[],
  factorKey: string
): number | null {
  const contributions: number[] = [];

  for (const entry of group) {
    const factor = entry.results.factors.find((f) => f.key === factorKey);
    if (factor) {
      contributions.push(-factor.score * factor.confidence);
    }
  }

  if (contributions.length === 0) {
    return null;
  }

  return (
    contributions.reduce((sum, value) => sum + value, 0) / contributions.length
  );
}

console.log(
  `## Factor signal — suspended (${confirmed.length}) vs surviving (${surviving.length}) suspected bots\n`
);
console.log(
  "Mean bot-ward contribution (-score × confidence). Positive delta =\n" +
    "signal ran hotter on accounts Reddit later suspended.\n"
);

const factorRows = FACTORS.map((factorMeta) => {
  const confirmedMean = meanBotwardContribution(confirmed, factorMeta.key);
  const survivingMean = meanBotwardContribution(surviving, factorMeta.key);
  const delta =
    confirmedMean !== null && survivingMean !== null
      ? confirmedMean - survivingMean
      : null;

  return { label: factorMeta.label, confirmedMean, survivingMean, delta };
}).sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

printTable(
  ["factor", "suspended", "surviving", "delta"],
  factorRows.map((row) => [
    row.label,
    row.confirmedMean !== null ? row.confirmedMean.toFixed(2) : "—",
    row.survivingMean !== null ? row.survivingMean.toFixed(2) : "—",
    row.delta !== null
      ? (row.delta >= 0 ? "+" : "") + row.delta.toFixed(2)
      : "—",
  ])
);
console.log("");

// --- Personas ---

console.log("## Persona labels — suspended vs surviving suspected bots\n");
const personaLabels = new Set<string>();
for (const entry of [...confirmed, ...surviving]) {
  personaLabels.add(entry.results.persona?.label ?? "(none)");
}

printTable(
  ["persona", "suspended", "surviving"],
  [...personaLabels]
    .sort()
    .map((label) => [
      label,
      String(
        confirmed.filter(
          (entry) => (entry.results.persona?.label ?? "(none)") === label
        ).length
      ),
      String(
        surviving.filter(
          (entry) => (entry.results.persona?.label ?? "(none)") === label
        ).length
      ),
    ])
);
console.log("");

// --- Longest-surviving bot verdicts ---

console.log("## Longest-surviving bot verdicts (still active at export)\n");
const survivors = surviving
  .slice()
  .sort((a, b) => a.results.runAt - b.results.runAt)
  .slice(0, 25);

printTable(
  [
    "username",
    "verdict",
    "prob",
    "verdict age",
    "checked",
    "strongest bot factor",
  ],
  survivors.map((entry) => {
    const strongest = entry.results.factors
      .slice()
      .sort((a, b) => -b.score * b.confidence - -a.score * a.confidence)[0];
    const strongestLabel = strongest
      ? (FACTORS.find((meta) => meta.key === strongest.key)?.label ??
        strongest.key)
      : "—";

    return [
      `u/${entry.username}`,
      entry.results.verdict,
      entry.results.botProbability.toFixed(2),
      `${daysAgo(entry.results.runAt)}d`,
      entry.report.userStatusCheckedAt > 0
        ? `${daysAgo(entry.report.userStatusCheckedAt)}d ago`
        : "never",
      strongestLabel,
    ];
  })
);

if (surviving.length > survivors.length) {
  console.log(`… and ${surviving.length - survivors.length} more.`);
}
