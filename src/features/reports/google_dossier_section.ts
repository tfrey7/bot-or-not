// "Google dossier" panel in the detail pane. Surfaces the posts captured
// by the google-harvest content script — Google's SERP for "<user>
// site:reddit.com", merged across every search the operator has run.
// Only renders when at least one post has been captured (the Search
// Google button in the actions row is the affordance to populate it).
//
// Sits next to "Your notes" because both are operator-curated context,
// not derived AI output.

import type { GoogleHarvest, GoogleHarvestPost } from "../../types.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import type { ReportRow } from "./logic.ts";

const POST_LIMIT = 30;

export function bonReportsGoogleDossierSection(
  report: ReportRow
): HTMLDivElement | null {
  const harvest = report.googleHarvest;
  if (!harvest || harvest.posts.length === 0) {
    return null;
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap bon-google-dossier";

  wrap.appendChild(buildTitleRow(harvest));

  const aggregates = buildAggregates(harvest);
  if (aggregates) {
    wrap.appendChild(aggregates);
  }

  wrap.appendChild(buildPostsDisclosure(harvest.posts));

  return wrap;
}

function buildPostsDisclosure(posts: GoogleHarvestPost[]): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "bon-google-dossier__posts-disclosure";

  const summary = document.createElement("summary");
  summary.className = "bon-google-dossier__posts-summary";

  const label = document.createElement("span");
  label.className = "bon-google-dossier__posts-summary-label";
  label.textContent = `Posts (${posts.length})`;
  summary.appendChild(label);

  details.appendChild(summary);
  details.appendChild(buildPostsList(posts));

  return details;
}

function buildTitleRow(harvest: GoogleHarvest): HTMLDivElement {
  const titleRow = document.createElement("div");
  titleRow.className = "bon-google-dossier__title-row";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Google dossier";
  titleRow.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "bon-google-dossier__meta";

  const postCount = harvest.posts.length;
  const searchCount = harvest.captureCount;
  const parts = [
    `${postCount} post${postCount === 1 ? "" : "s"}`,
    `last ${bonFormatDate(harvest.lastCapturedAt)}`,
    `${searchCount} search${searchCount === 1 ? "" : "es"}`,
  ];

  meta.textContent = parts.join(" · ");
  meta.title =
    `First captured ${bonFormatDate(harvest.firstCapturedAt)}, ` +
    `last ${bonFormatDate(harvest.lastCapturedAt)}`;
  titleRow.appendChild(meta);

  return titleRow;
}

function buildAggregates(harvest: GoogleHarvest): HTMLDivElement | null {
  const subs = Object.entries(harvest.subredditDistribution).sort(
    (a, b) => b[1] - a[1]
  );

  if (subs.length === 0) {
    return null;
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-google-dossier__aggregates";

  for (const [sub, count] of subs) {
    const chip = document.createElement("span");
    chip.className = "bon-google-dossier__chip";
    chip.textContent = count > 1 ? `r/${sub} ×${count}` : `r/${sub}`;
    wrap.appendChild(chip);
  }

  return wrap;
}

function buildPostsList(posts: GoogleHarvestPost[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "bon-google-dossier__posts";

  // Most-recently-seen first. Posts that have fallen out of Google's index
  // sink to the bottom — they're still useful evidence but the active
  // narrative is at the top.
  const sorted = [...posts].sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  for (const post of sorted.slice(0, POST_LIMIT)) {
    list.appendChild(buildPostItem(post));
  }

  if (sorted.length > POST_LIMIT) {
    const overflow = document.createElement("li");
    overflow.className = "bon-google-dossier__overflow";
    overflow.textContent = `+${sorted.length - POST_LIMIT} more`;
    list.appendChild(overflow);
  }

  return list;
}

function buildPostItem(post: GoogleHarvestPost): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "bon-google-dossier__post";

  const titleLink = document.createElement("a");
  titleLink.className = "bon-google-dossier__post-title";
  titleLink.href = post.url;
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.textContent = post.title || post.slug || post.url;
  item.appendChild(titleLink);

  const metaLine = document.createElement("div");
  metaLine.className = "bon-google-dossier__post-meta";

  const metaParts: string[] = [];

  if (post.subreddit) {
    metaParts.push(`r/${post.subreddit}`);
  }

  metaParts.push(formatKind(post.kind));

  if (post.ageHint) {
    metaParts.push(post.ageHint);
  }

  if (post.commentCountHint !== null) {
    metaParts.push(
      `${post.commentCountHint} comment${post.commentCountHint === 1 ? "" : "s"}`
    );
  }

  metaLine.textContent = metaParts.join(" · ");
  metaLine.title = `First seen ${bonFormatDate(post.firstSeenAt)}`;
  item.appendChild(metaLine);

  if (post.snippetText) {
    const snippet = document.createElement("div");
    snippet.className = "bon-google-dossier__post-snippet";
    snippet.textContent = post.snippetText;
    item.appendChild(snippet);
  }

  return item;
}

function formatKind(kind: GoogleHarvestPost["kind"]): string {
  if (kind === "sub-post") {
    return "post";
  }

  if (kind === "profile-post") {
    return "profile post";
  }

  if (kind === "profile-root") {
    return "profile";
  }

  return kind;
}
