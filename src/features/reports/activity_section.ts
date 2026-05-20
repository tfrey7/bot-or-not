// "Activity heatmap" section — renders the calendar + hour heatmap from
// the activity data captured during investigation. Activity is populated
// in the same pipeline as the AI verdict; there is no separate Reddit
// fetch from this surface.

import { bonReportsCalendarHeatmap } from "./calendar_heatmap.ts";
import { bonReportsHourSection } from "./hour_heatmap.ts";
import { bonReportsSubredditChartOverlaid } from "./subreddit_chart_overlaid.ts";
import type { ReportRow } from "./logic.ts";

export function bonReportsActivitySection(report: ReportRow): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Activity heatmap";
  wrap.appendChild(title);

  const { activityData } = report;

  if (!activityData) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent =
      "Investigate this user to populate the activity heatmap.";
    wrap.appendChild(empty);
    return wrap;
  }

  const timestamps = [
    ...(activityData.postTimestamps || []),
    ...(activityData.commentTimestamps || []),
  ].sort((a, b) => a - b);

  if (timestamps.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent = "No public posts or comments to plot.";
    wrap.appendChild(empty);
    return wrap;
  }

  const meta = document.createElement("p");
  meta.className = "bon-heatmap-row";

  const postsCount = (activityData.postTimestamps || []).length;
  const commentsCount = (activityData.commentTimestamps || []).length;
  const postsLabel = postsCount === 1 ? "post" : "posts";
  const commentsLabel = commentsCount === 1 ? "comment" : "comments";

  const countSpan = document.createElement("span");
  const postsStrong = document.createElement("strong");
  postsStrong.textContent = String(postsCount);
  const commentsStrong = document.createElement("strong");
  commentsStrong.textContent = String(commentsCount);
  countSpan.append(
    postsStrong,
    ` ${postsLabel} · `,
    commentsStrong,
    ` ${commentsLabel}`
  );
  meta.appendChild(countSpan);

  const earliest = timestamps[0];
  const earliestSpan = document.createElement("span");
  earliestSpan.textContent = `oldest visible: ${new Date(earliest).toLocaleDateString()}`;
  meta.appendChild(earliestSpan);

  wrap.appendChild(meta);

  wrap.appendChild(bonReportsCalendarHeatmap(timestamps, activityData));
  wrap.appendChild(bonReportsHourSection(timestamps));
  wrap.appendChild(
    bonReportsSubredditChartOverlaid(activityData, report.createdAt)
  );

  return wrap;
}
