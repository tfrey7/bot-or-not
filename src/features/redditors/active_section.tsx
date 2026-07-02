// "In progress" section above the main list — running/queued rows plus the
// queue-pause banner. Only the first N rows are shown; a burst enqueue
// (e.g. profiling a 100-user subreddit) would otherwise push the rest of
// the page out of view, and the title still surfaces the full counts.

import { INVESTIGATION_CONCURRENCY } from "../investigation";
import type { ReportRow } from "./logic.ts";
import { redditorsCountQueuedAhead } from "./logic.ts";
import { RedditorsRow } from "./table_row.tsx";

const ACTIVE_TABLE_VISIBLE_MAX = 10;

export interface ActiveSectionProps {
  rows: ReportRow[];
  allReports: ReportRow[];
  selectedUsername: string | null;
  paused: boolean;
  onSelect: (username: string) => void;
}

export function ActiveSection({
  rows,
  allReports,
  selectedUsername,
  paused,
  onSelect,
}: ActiveSectionProps) {
  let running = 0;
  let queued = 0;

  for (const row of rows) {
    if (row.investigation?.status === "running") {
      running += 1;
    } else if (row.investigation?.status === "queued") {
      queued += 1;
    }
  }

  // Only expose the running/queued split (and concurrency cap) when there's
  // queue pressure — otherwise the bare count is enough and the rows below
  // make the running-vs-queued status obvious.
  const title =
    queued > 0
      ? `In progress · ${running} running · ${queued} queued (cap ${INVESTIGATION_CONCURRENCY})`
      : `In progress · ${rows.length}`;

  const visibleRows = rows.slice(0, ACTIVE_TABLE_VISIBLE_MAX);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <section
      class="bon-list-section bon-list-section--active"
      id="bon-active-section"
      hidden={rows.length === 0 && !paused}
    >
      <p
        class="bon-list-section-title"
        id="bon-active-title"
        hidden={rows.length === 0}
      >
        {rows.length === 0 ? "" : title}
      </p>
      {/* queue_pause.ts owns this element's hidden/text imperatively; Preact
          never changes these props, so the diff leaves its edits alone. */}
      <p
        class="bon-queue-pause"
        id="bon-queue-pause"
        role="status"
        aria-live="polite"
        hidden
      ></p>
      <div class="bon-table-wrap">
        <table class="bon-table">
          <tbody id="bon-tbody-active">
            {visibleRows.map((report) => (
              <RedditorsRow
                key={report.username}
                report={report}
                selected={selectedUsername === report.username}
                queueAhead={redditorsCountQueuedAhead(allReports, report)}
                onSelect={onSelect}
              />
            ))}
            {hiddenCount > 0 && (
              <tr class="bon-active-overflow">
                <td colSpan={2}>
                  +{hiddenCount} more queued — will appear as slots free up
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
