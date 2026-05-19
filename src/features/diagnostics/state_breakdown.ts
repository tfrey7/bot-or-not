// Counts grouped by Investigation / BotBouncer / User / flags. Renders as a
// stack of small tables — one per dimension — so the diagnostics tab reads
// like a quick health check of what's actually in storage.

import type { DiagnosticsSummary } from "./logic.ts";

export function bonDiagnosticsStateBreakdown(
  summary: DiagnosticsSummary
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-diag-tables";

  wrap.appendChild(
    buildTable("Investigations", [
      ["Never run", summary.totalRecords - summary.investigated],
      ["Running", summary.investigationRunning],
      ["Done", summary.investigationDone],
      ["Errored", summary.investigationError],
      ["Total runs recorded", summary.totalRuns],
    ])
  );

  wrap.appendChild(
    buildTable("Verdicts (completed)", [
      ["Bot", summary.verdictCounts.bot],
      ["Likely bot", summary.verdictCounts["likely-bot"]],
      ["Uncertain", summary.verdictCounts.uncertain],
      ["Likely human", summary.verdictCounts["likely-human"]],
      ["Human", summary.verdictCounts.human],
    ])
  );

  wrap.appendChild(
    buildTable("BotBouncer", [
      ["Banned", summary.botBouncerBanned],
      ["Pending", summary.botBouncerPending],
      ["Organic", summary.botBouncerOrganic],
      ["Unknown", summary.botBouncerUnknown],
    ])
  );

  wrap.appendChild(
    buildTable("Reddit account status", [
      ["Active", summary.userActive],
      ["Suspended", summary.userSuspended],
      ["Unknown", summary.userUnknown],
    ])
  );

  wrap.appendChild(
    buildTable("Attached data", [
      ["With report history", summary.withHistory],
      ["With activity heatmap", summary.withActivity],
      [
        "In a ring",
        summary.withRing,
        summary.distinctRings > 0
          ? `${summary.distinctRings} distinct`
          : undefined,
      ],
    ])
  );

  return wrap;
}

function buildTable(
  title: string,
  rows: Array<[string, number, string?]>
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "bon-diag-table";

  const heading = document.createElement("p");
  heading.className = "bon-diag-table-title";
  heading.textContent = title;
  card.appendChild(heading);

  const table = document.createElement("table");
  table.className = "bon-diag-kv";

  for (const [label, value, hint] of rows) {
    const tr = document.createElement("tr");

    const labelCell = document.createElement("td");
    labelCell.className = "bon-diag-kv-label";
    labelCell.textContent = label;
    tr.appendChild(labelCell);

    const valueCell = document.createElement("td");
    valueCell.className = "bon-diag-kv-value";
    valueCell.textContent = String(value);
    tr.appendChild(valueCell);

    const hintCell = document.createElement("td");
    hintCell.className = "bon-diag-kv-hint";
    hintCell.textContent = hint ?? "";
    tr.appendChild(hintCell);

    table.appendChild(tr);
  }

  card.appendChild(table);
  return card;
}
