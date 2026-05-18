// Run log — one row per completed investigation, newest first. The raw
// per-run record behind the aggregations above. Capped at MAX_RUN_ROWS so
// a chatty user doesn't blow up the page; older runs are still counted in
// the summary.

import {
  bonFmtPercent,
  bonFmtThousands,
  bonFmtUsd,
} from "../../utils/format_number.ts";
import { bonFmtDuration, bonFmtTimestamp } from "../../utils/format_time.ts";
import type { AnalyticsEntry } from "./logic.ts";

const MAX_RUN_ROWS = 100;

export function bonAnalyticsRunLog(runs: AnalyticsEntry[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-analytics-table-card";

  const title = document.createElement("h3");
  title.className = "bon-analytics-section-title";
  title.textContent = "Run log";
  wrap.appendChild(title);

  if (!runs.length) {
    const p = document.createElement("p");
    p.className = "bon-analytics-empty-small";
    p.textContent = "No runs to list.";
    wrap.appendChild(p);
    return wrap;
  }

  const sorted = [...runs].sort((a, b) => (b.runAt || 0) - (a.runAt || 0));
  const rows = sorted.slice(0, MAX_RUN_ROWS);

  const table = document.createElement("table");
  table.className = "bon-analytics-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [
    "When",
    "User",
    "Verdict",
    "Persona",
    "Model",
    "Duration",
    "Calls",
    "Tokens",
    "Cost",
  ].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const r of rows) {
    const tr = document.createElement("tr");

    const tdWhen = document.createElement("td");
    tdWhen.textContent = r.runAt ? bonFmtTimestamp(r.runAt) : "—";
    tr.appendChild(tdWhen);

    const tdUser = document.createElement("td");
    const a = document.createElement("a");
    a.className = "bon-analytics-top-name";
    a.href = `https://www.reddit.com/user/${encodeURIComponent(r.username)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `u/${r.username}`;
    tdUser.appendChild(a);
    tr.appendChild(tdUser);

    const tdVerdict = document.createElement("td");
    tdVerdict.textContent = formatVerdictCell(r);
    tr.appendChild(tdVerdict);

    const tdPersona = document.createElement("td");
    tdPersona.textContent = r.persona || "—";
    tr.appendChild(tdPersona);

    const tdModel = document.createElement("td");
    const primaryModel = r.calls[0]?.model || null;

    if (primaryModel) {
      const code = document.createElement("code");
      code.textContent = shortModelName(primaryModel);
      tdModel.appendChild(code);
    } else {
      tdModel.textContent = "—";
    }

    tr.appendChild(tdModel);

    const tdDuration = document.createElement("td");
    tdDuration.textContent = bonFmtDuration(r.durationMs);
    tr.appendChild(tdDuration);

    const tdCalls = document.createElement("td");
    tdCalls.textContent = String(r.calls.length);
    tr.appendChild(tdCalls);

    const tdTokens = document.createElement("td");
    const tokenTotal = sumRunTokens(r);
    tdTokens.textContent = tokenTotal > 0 ? bonFmtThousands(tokenTotal) : "—";
    tr.appendChild(tdTokens);

    const tdCost = document.createElement("td");
    tdCost.textContent = bonFmtUsd(r.totalCost);
    tr.appendChild(tdCost);

    if (r.summary) {
      tr.title = r.summary;
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const scroll = document.createElement("div");
  scroll.className = "bon-analytics-table-scroll";
  scroll.appendChild(table);
  wrap.appendChild(scroll);

  if (sorted.length > rows.length) {
    const note = document.createElement("p");
    note.className = "bon-analytics-empty-small";
    note.style.marginTop = "0.75em";
    note.textContent = `Showing ${rows.length} most recent of ${sorted.length} runs.`;
    wrap.appendChild(note);
  }
  return wrap;
}

function sumRunTokens(r: AnalyticsEntry): number {
  let total = 0;

  for (const c of r.calls) {
    const u = c.usage || {};
    total +=
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      (u.cache_creation_input_tokens || 0);
  }
  return total;
}

function formatVerdictCell(r: AnalyticsEntry): string {
  if (!r.verdict) {
    return "—";
  }

  const label = r.verdict.replace(/-/g, " ");

  if (typeof r.botProbability === "number") {
    return `${label} · ${bonFmtPercent(r.botProbability)} bot`;
  }

  if (typeof r.confidence === "number") {
    return `${label} · ${bonFmtPercent(r.confidence)} conf`;
  }
  return label;
}

function shortModelName(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
