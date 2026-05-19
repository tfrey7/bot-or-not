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
    const emptyMsg = document.createElement("p");
    emptyMsg.className = "bon-analytics-empty-small";
    emptyMsg.textContent = "No runs to list.";
    wrap.appendChild(emptyMsg);
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

  for (const run of rows) {
    const tr = document.createElement("tr");

    const tdWhen = document.createElement("td");
    tdWhen.textContent = run.runAt ? bonFmtTimestamp(run.runAt) : "—";
    tr.appendChild(tdWhen);

    const tdUser = document.createElement("td");
    const userLink = document.createElement("a");
    userLink.className = "bon-analytics-top-name";
    userLink.href = `https://www.reddit.com/user/${encodeURIComponent(run.username)}`;
    userLink.target = "_blank";
    userLink.rel = "noopener noreferrer";
    userLink.textContent = `u/${run.username}`;
    tdUser.appendChild(userLink);
    tr.appendChild(tdUser);

    const tdVerdict = document.createElement("td");
    tdVerdict.textContent = formatVerdictCell(run);
    tr.appendChild(tdVerdict);

    const tdPersona = document.createElement("td");
    tdPersona.textContent = run.persona || "—";
    tr.appendChild(tdPersona);

    const tdModel = document.createElement("td");
    const primaryModel = run.calls[0]?.model || null;

    if (primaryModel) {
      const code = document.createElement("code");
      code.textContent = shortModelName(primaryModel);
      tdModel.appendChild(code);
    } else {
      tdModel.textContent = "—";
    }

    tr.appendChild(tdModel);

    const tdDuration = document.createElement("td");
    tdDuration.textContent = bonFmtDuration(run.durationMs);
    tr.appendChild(tdDuration);

    const tdCalls = document.createElement("td");
    tdCalls.textContent = String(run.calls.length);
    tr.appendChild(tdCalls);

    const tdTokens = document.createElement("td");
    const tokenTotal = sumRunTokens(run);
    tdTokens.textContent = tokenTotal > 0 ? bonFmtThousands(tokenTotal) : "—";
    tr.appendChild(tdTokens);

    const tdCost = document.createElement("td");
    tdCost.textContent = bonFmtUsd(run.totalCost);
    tr.appendChild(tdCost);

    if (run.summary) {
      tr.title = run.summary;
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

function sumRunTokens(run: AnalyticsEntry): number {
  let total = 0;

  for (const call of run.calls) {
    const usage = call.usage || {};
    total +=
      (usage.input_tokens || 0) +
      (usage.output_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
  }

  return total;
}

function formatVerdictCell(run: AnalyticsEntry): string {
  if (!run.verdict) {
    return "—";
  }

  const label = run.verdict.replace(/-/g, " ");

  if (typeof run.botProbability === "number") {
    return `${label} · ${bonFmtPercent(run.botProbability)} bot`;
  }

  if (typeof run.confidence === "number") {
    return `${label} · ${bonFmtPercent(run.confidence)} conf`;
  }

  return label;
}

function shortModelName(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
