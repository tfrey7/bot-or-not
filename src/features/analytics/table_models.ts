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
  for (const r of runs) {
    for (const c of r.calls) {
      const key = c.model || "(unknown)";
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
      row.cost += c.costUsd || 0;
      const u = c.usage || {};
      row.in += u.input_tokens || 0;
      row.out += u.output_tokens || 0;
      row.cacheRead += u.cache_read_input_tokens || 0;
      row.cacheWrite += u.cache_creation_input_tokens || 0;
      byModel.set(key, row);

      if (typeof r.durationMs === "number") {
        if (!durationsByModel.has(key)) {
          durationsByModel.set(key, []);
        }
        durationsByModel.get(key)!.push(r.durationMs);
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
  ].forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.align) {
      th.style.textAlign = c.align;
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const hit = r.in + r.cacheRead > 0 ? r.cacheRead / (r.in + r.cacheRead) : 0;
    const durs = durationsByModel.get(r.model) || [];
    const avgDur = durs.length
      ? durs.reduce((a, b) => a + b, 0) / durs.length
      : null;

    const tdModel = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = r.model;
    tdModel.appendChild(code);
    tr.appendChild(tdModel);

    [
      String(r.calls),
      bonFmtThousands(r.in),
      bonFmtThousands(r.out),
      bonFmtThousands(r.cacheRead),
      bonFmtThousands(r.cacheWrite),
      bonFmtPercent(hit),
      bonFmtDuration(avgDur),
      bonFmtUsd(r.cost / Math.max(1, r.calls)),
      bonFmtUsd(r.cost),
    ].forEach((val) => {
      const td = document.createElement("td");
      td.textContent = val;
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
