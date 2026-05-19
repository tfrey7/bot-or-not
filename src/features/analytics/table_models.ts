// Per-model breakdown — one row per model used, with calls, token totals,
// cache hit rate, average duration, and total cost.

import {
  bonFmtPercent,
  bonFmtThousands,
  bonFmtUsd,
} from "../../utils/format_number.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import type { AnalyticsEntry } from "./logic.ts";

interface ModelRow {
  model: string;
  calls: number;
  cost: number;
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

export function bonAnalyticsModelsTable(
  runs: AnalyticsEntry[]
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-table-card";

  const title = document.createElement("h3");
  title.className = "bon-analytics-section-title";
  title.textContent = "Per-model breakdown";
  wrap.appendChild(title);

  const byModel = new Map<string, ModelRow>();
  const durationsByModel = new Map<string, number[]>();

  for (const run of runs) {
    for (const call of run.calls) {
      const key = call.model || "(unknown)";
      const row = byModel.get(key) || {
        model: key,
        calls: 0,
        cost: 0,
        in: 0,
        out: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      row.calls++;
      row.cost += call.costUsd || 0;
      const usage = call.usage || {};
      row.in += usage.input_tokens || 0;
      row.out += usage.output_tokens || 0;
      row.cacheRead += usage.cache_read_input_tokens || 0;
      row.cacheWrite += usage.cache_creation_input_tokens || 0;
      byModel.set(key, row);

      if (typeof run.durationMs === "number") {
        if (!durationsByModel.has(key)) {
          durationsByModel.set(key, []);
        }

        durationsByModel.get(key)!.push(run.durationMs);
      }
    }
  }

  const rows = Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);

  if (!rows.length) {
    return wrap;
  }

  const table = document.createElement("table");
  table.className = "bon-analytics-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  [
    { label: "Model", align: "left" as const },
    { label: "Calls" },
    { label: "Input" },
    { label: "Output" },
    { label: "Cache read" },
    { label: "Cache write" },
    { label: "Cache hit" },
    { label: "Avg duration" },
    { label: "Avg / call" },
    { label: "Total cost" },
  ].forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column.label;

    if (column.align) {
      th.style.textAlign = column.align;
    }

    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const row of rows) {
    const tr = document.createElement("tr");
    const hit =
      row.in + row.cacheRead > 0 ? row.cacheRead / (row.in + row.cacheRead) : 0;
    const durations = durationsByModel.get(row.model) || [];
    const avgDuration = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

    const tdModel = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = row.model;
    tdModel.appendChild(code);
    tr.appendChild(tdModel);

    [
      String(row.calls),
      bonFmtThousands(row.in),
      bonFmtThousands(row.out),
      bonFmtThousands(row.cacheRead),
      bonFmtThousands(row.cacheWrite),
      bonFmtPercent(hit),
      bonFmtDuration(avgDuration),
      bonFmtUsd(row.cost / Math.max(1, row.calls)),
      bonFmtUsd(row.cost),
    ].forEach((cellText) => {
      const td = document.createElement("td");
      td.textContent = cellText;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const scroll = document.createElement("div");
  scroll.className = "bon-analytics-table-scroll";
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}
