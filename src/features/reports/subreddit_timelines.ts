// Per-subreddit table: posts/comments counts, first/last seen, and an inline
// sparkline showing posts and comments separately across the same time range.
// Rows share the X-axis (account creation → now, or earliest visible event →
// now when account age is unknown) so the *timing* is comparable row to row.
// The Y-axis is per-row — each sparkline scales to its own peak — so subs
// with only a handful of events still show a readable shape instead of being
// flattened by a louder neighbour.

import { bonFormatDate } from "../../utils/format_time.ts";
import {
  bonReportsBuildSubredditTimelines,
  type SubredditTimeline,
} from "./logic.ts";
import type { ActivityData } from "../../types.ts";

const BON_TIMELINE_BUCKETS = 48;
const BON_TIMELINE_SVG_WIDTH = 200;
const BON_TIMELINE_SVG_HEIGHT = 28;
const SVG_NS = "http://www.w3.org/2000/svg";

function bucketEvents(
  events: number[],
  rangeStart: number,
  rangeEnd: number,
  buckets: number
): number[] {
  const counts = new Array<number>(buckets).fill(0);
  const span = rangeEnd - rangeStart;
  if (span <= 0) {
    return counts;
  }

  for (const t of events) {
    if (t < rangeStart || t > rangeEnd) {
      continue;
    }

    const ratio = (t - rangeStart) / span;
    const index = Math.min(buckets - 1, Math.floor(ratio * buckets));
    counts[index]++;
  }

  return counts;
}

function polylinePoints(
  counts: number[],
  peak: number,
  width: number,
  height: number,
  pad: number
): string {
  if (peak <= 0 || counts.length === 0) {
    const y = height - pad;
    return `0,${y} ${width},${y}`;
  }

  const usable = height - pad * 2;
  const step = width / Math.max(1, counts.length - 1);
  const points: string[] = [];

  for (let i = 0; i < counts.length; i++) {
    const x = i * step;
    const y = height - pad - (counts[i] / peak) * usable;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  return points.join(" ");
}

function renderSparkline(
  timeline: SubredditTimeline,
  rangeStart: number,
  rangeEnd: number
): SVGSVGElement {
  const width = BON_TIMELINE_SVG_WIDTH;
  const height = BON_TIMELINE_SVG_HEIGHT;
  const pad = 2;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "bon-sub-spark");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");

  const baseline = document.createElementNS(SVG_NS, "line");
  baseline.setAttribute("x1", "0");
  baseline.setAttribute("x2", String(width));
  baseline.setAttribute("y1", String(height - pad));
  baseline.setAttribute("y2", String(height - pad));
  baseline.setAttribute("class", "bon-sub-spark-base");
  svg.appendChild(baseline);

  const postBuckets = bucketEvents(
    timeline.postEvents,
    rangeStart,
    rangeEnd,
    BON_TIMELINE_BUCKETS
  );
  const commentBuckets = bucketEvents(
    timeline.commentEvents,
    rangeStart,
    rangeEnd,
    BON_TIMELINE_BUCKETS
  );

  const rowPeak = Math.max(1, ...postBuckets, ...commentBuckets);

  const commentLine = document.createElementNS(SVG_NS, "polyline");
  commentLine.setAttribute(
    "class",
    "bon-sub-spark-line bon-sub-spark-line--comment"
  );
  commentLine.setAttribute(
    "points",
    polylinePoints(commentBuckets, rowPeak, width, height, pad)
  );
  svg.appendChild(commentLine);

  const postLine = document.createElementNS(SVG_NS, "polyline");
  postLine.setAttribute("class", "bon-sub-spark-line bon-sub-spark-line--post");
  postLine.setAttribute(
    "points",
    polylinePoints(postBuckets, rowPeak, width, height, pad)
  );
  svg.appendChild(postLine);

  return svg;
}

function renderHeaderCell(label: string, cls?: string): HTMLTableCellElement {
  const th = document.createElement("th");
  th.textContent = label;
  if (cls) {
    th.className = cls;
  }

  return th;
}

function subredditLink(sub: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `https://www.reddit.com/r/${encodeURIComponent(sub)}/`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `r/${sub}`;
  link.className = "bon-sub-link";
  return link;
}

export function bonReportsSubredditTimelines(
  activityData: ActivityData,
  accountCreatedAt: number | null
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-sub-timelines";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "By-subreddit timeline";
  wrap.appendChild(title);

  const timelines = bonReportsBuildSubredditTimelines(activityData);

  if (!timelines) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent =
      "Per-subreddit timing data was added after this snapshot was captured — refresh activity to populate it.";
    wrap.appendChild(empty);
    return wrap;
  }

  if (timelines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent = "No public posts or comments to plot.";
    wrap.appendChild(empty);
    return wrap;
  }

  const earliestEvent = Math.min(
    ...timelines.map((timeline) => timeline.firstSeen)
  );
  const latestEvent = Math.max(
    ...timelines.map((timeline) => timeline.lastSeen)
  );
  const rangeStart =
    accountCreatedAt && accountCreatedAt < earliestEvent
      ? accountCreatedAt
      : earliestEvent;
  const rangeEnd = Math.max(latestEvent, Date.now());

  const legend = document.createElement("p");
  legend.className = "bon-sub-legend";
  const postSwatch = document.createElement("span");
  postSwatch.className = "bon-sub-swatch bon-sub-swatch--post";
  const commentSwatch = document.createElement("span");
  commentSwatch.className = "bon-sub-swatch bon-sub-swatch--comment";
  legend.append(postSwatch, " posts · ", commentSwatch, " comments");
  wrap.appendChild(legend);

  const table = document.createElement("table");
  table.className = "bon-sub-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(renderHeaderCell("Subreddit"));
  headRow.appendChild(renderHeaderCell("Posts", "bon-sub-num"));
  headRow.appendChild(renderHeaderCell("Comments", "bon-sub-num"));
  headRow.appendChild(renderHeaderCell("Total", "bon-sub-num"));
  headRow.appendChild(renderHeaderCell("First seen"));
  headRow.appendChild(renderHeaderCell("Last seen"));
  headRow.appendChild(renderHeaderCell("Timeline", "bon-sub-spark-col"));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");

  for (const timeline of timelines) {
    const row = document.createElement("tr");

    const subCell = document.createElement("td");
    subCell.appendChild(subredditLink(timeline.sub));
    row.appendChild(subCell);

    const postsCell = document.createElement("td");
    postsCell.className = "bon-sub-num";
    postsCell.textContent = String(timeline.posts);
    row.appendChild(postsCell);

    const commentsCell = document.createElement("td");
    commentsCell.className = "bon-sub-num";
    commentsCell.textContent = String(timeline.comments);
    row.appendChild(commentsCell);

    const totalCell = document.createElement("td");
    totalCell.className = "bon-sub-num";
    totalCell.textContent = String(timeline.total);
    row.appendChild(totalCell);

    const firstCell = document.createElement("td");
    firstCell.textContent = bonFormatDate(timeline.firstSeen);
    firstCell.title = new Date(timeline.firstSeen).toLocaleString();
    row.appendChild(firstCell);

    const lastCell = document.createElement("td");
    lastCell.textContent = bonFormatDate(timeline.lastSeen);
    lastCell.title = new Date(timeline.lastSeen).toLocaleString();
    row.appendChild(lastCell);

    const sparkCell = document.createElement("td");
    sparkCell.className = "bon-sub-spark-col";
    sparkCell.appendChild(renderSparkline(timeline, rangeStart, rangeEnd));
    row.appendChild(sparkCell);

    body.appendChild(row);
  }

  table.appendChild(body);

  wrap.appendChild(table);
  return wrap;
}
