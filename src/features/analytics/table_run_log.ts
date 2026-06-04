// Run log — one row per completed investigation, newest first. Paginated
// over the full history; the orchestrator owns the current page index
// and re-renders this widget when it changes.

import { fmtPercent, fmtThousands, fmtUsd } from "../../utils/format_number.ts";
import { fmtDuration, fmtTimestamp } from "../../utils/format_time.ts";
import { pagination } from "../../utils/pagination.ts";
import type { AnalyticsEntry } from "./logic.ts";

const ANALYTICS_RUN_LOG_PAGE_SIZE = 25;

export interface RunLogOpts {
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function analyticsRunLog(
  runs: AnalyticsEntry[],
  opts: RunLogOpts
): HTMLDivElement {
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

  const totalPages = Math.max(
    1,
    Math.ceil(sorted.length / ANALYTICS_RUN_LOG_PAGE_SIZE)
  );
  const currentPage = Math.min(Math.max(1, opts.currentPage), totalPages);
  const pageStart = (currentPage - 1) * ANALYTICS_RUN_LOG_PAGE_SIZE;
  const pageEnd = pageStart + ANALYTICS_RUN_LOG_PAGE_SIZE;
  const rows = sorted.slice(pageStart, pageEnd);

  const table = document.createElement("table");
  table.className = "bon-analytics-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["When", "User", "Verdict", "Model", "Duration", "Tokens", "Cost"].forEach(
    (label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
  );
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const run of rows) {
    const tr = document.createElement("tr");

    const tdWhen = document.createElement("td");
    tdWhen.textContent = run.runAt ? fmtTimestamp(run.runAt) : "—";
    tr.appendChild(tdWhen);

    const tdUser = document.createElement("td");
    const userLink = document.createElement("a");
    userLink.className = "bon-analytics-top-name bon-pii-name";
    userLink.href = `?user=${encodeURIComponent(run.username)}`;
    userLink.textContent = `u/${run.username}`;
    tdUser.appendChild(userLink);
    tr.appendChild(tdUser);

    const tdVerdict = document.createElement("td");
    tdVerdict.textContent = formatVerdictCell(run);
    tr.appendChild(tdVerdict);

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
    tdDuration.textContent = fmtDuration(run.durationMs);
    tr.appendChild(tdDuration);

    const tdTokens = document.createElement("td");
    const tokenTotal = sumRunTokens(run);
    tdTokens.textContent = tokenTotal > 0 ? fmtThousands(tokenTotal) : "—";
    tr.appendChild(tdTokens);

    const tdCost = document.createElement("td");
    tdCost.textContent = fmtUsd(run.totalCost);
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

  if (totalPages > 1) {
    wrap.appendChild(
      pagination({
        currentPage,
        totalPages,
        totalItems: sorted.length,
        pageSize: ANALYTICS_RUN_LOG_PAGE_SIZE,
        onPageChange: opts.onPageChange,
      })
    );
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
    return `${label} · ${fmtPercent(run.botProbability)} bot`;
  }

  if (typeof run.confidence === "number") {
    return `${label} · ${fmtPercent(run.confidence)} conf`;
  }

  return label;
}

function shortModelName(model: string): string {
  // Strip both Anthropic's `-YYYYMMDD` and OpenAI's `-YYYY-MM-DD` date
  // pins. Keep the vendor prefix (`claude-`, `gpt-`) since multi-vendor
  // run logs need it to disambiguate at a glance.
  return model.replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
}
