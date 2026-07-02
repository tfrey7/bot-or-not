// Run log — one row per completed investigation, newest first. Paginated
// over the full history; the orchestrator owns the current page index.

import { useEffect, useRef } from "preact/hooks";
import { fmtPercent, fmtThousands, fmtUsd } from "../../utils/format_number.ts";
import { fmtDuration, fmtTimestamp } from "../../utils/format_time.ts";
import { pagination } from "../../utils/pagination.ts";
import type { AnalyticsEntry } from "./logic.ts";

const ANALYTICS_RUN_LOG_PAGE_SIZE = 25;

export interface RunLogProps {
  runs: AnalyticsEntry[];
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function RunLog({ runs, currentPage, onPageChange }: RunLogProps) {
  if (!runs.length) {
    return (
      <div class="bon-analytics-table-card">
        <h3 class="bon-analytics-section-title">Run log</h3>
        <p class="bon-analytics-empty-small">No runs to list.</p>
      </div>
    );
  }

  const sorted = [...runs].sort((a, b) => (b.runAt || 0) - (a.runAt || 0));

  const totalPages = Math.max(
    1,
    Math.ceil(sorted.length / ANALYTICS_RUN_LOG_PAGE_SIZE)
  );
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const pageStart = (page - 1) * ANALYTICS_RUN_LOG_PAGE_SIZE;
  const rows = sorted.slice(pageStart, pageStart + ANALYTICS_RUN_LOG_PAGE_SIZE);

  return (
    <div class="bon-analytics-table-card">
      <h3 class="bon-analytics-section-title">Run log</h3>
      <div class="bon-analytics-table-scroll">
        <table class="bon-analytics-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Verdict</th>
              <th>Model</th>
              <th>Duration</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <RunRow key={`${run.username}-${run.runAt ?? 0}`} run={run} />
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <PaginationHost
          currentPage={page}
          totalPages={totalPages}
          totalItems={sorted.length}
          pageSize={ANALYTICS_RUN_LOG_PAGE_SIZE}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}

function RunRow({ run }: { run: AnalyticsEntry }) {
  const primaryModel = run.calls[0]?.model || null;
  const tokenTotal = sumRunTokens(run);

  return (
    <tr title={run.summary || undefined}>
      <td>{run.runAt ? fmtTimestamp(run.runAt) : "—"}</td>
      <td>
        <a
          class="bon-analytics-top-name bon-pii-name"
          href={`?user=${encodeURIComponent(run.username)}`}
        >
          u/{run.username}
        </a>
      </td>
      <td>{formatVerdictCell(run)}</td>
      <td>
        {primaryModel ? <code>{shortModelName(primaryModel)}</code> : "—"}
      </td>
      <td>{fmtDuration(run.durationMs)}</td>
      <td>{tokenTotal > 0 ? fmtThousands(tokenTotal) : "—"}</td>
      <td>{fmtUsd(run.totalCost)}</td>
    </tr>
  );
}

// The pagination footer is a shared vanilla widget (the Redditors tab uses
// it too), so it mounts via a ref instead of being duplicated as JSX.
function PaginationHost(props: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    host.current?.replaceChildren(pagination(props));
  }, [
    props.currentPage,
    props.totalPages,
    props.totalItems,
    props.pageSize,
    props.onPageChange,
  ]);

  return <div ref={host} />;
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
