// Reddit-style profile header shown above the AI investigation in the
// detail pane. Username on the left, cake day + karma + contributions +
// report tally inline as muted metadata. Lazily kicks off an /about.json
// fetch if we don't have the cake day / karma yet.

import type { ReportRow } from "./logic.ts";
import { bonFetchAndStoreProfileStats } from "../../utils/fetch_profile_stats.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import { bonReportsDemographicsBadge } from "./cell_demographics.ts";
import { bonReportsRegionBadge } from "./cell_region.ts";
import { bonReportsVerdictBadge } from "./cell_verdict.ts";

function formatKarma(total: number): string {
  if (total >= 1_000_000) {
    return `${(total / 1_000_000).toFixed(total >= 10_000_000 ? 0 : 1)}M`;
  }

  if (total >= 10_000) {
    return `${Math.round(total / 1000)}k`;
  }

  return total.toLocaleString();
}

function formatCakeDay(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatAccountAge(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.floor(diffMs / day));

  if (days < 1) {
    return "<1d";
  }

  if (days < 30) {
    return `${days}d`;
  }

  if (days < 365) {
    return `${Math.floor(days / 30)}mo`;
  }

  const years = Math.floor(days / 365);
  const remainderMonths = Math.floor((days - years * 365) / 30);
  if (remainderMonths === 0) {
    return `${years}y`;
  }

  return `${years}y ${remainderMonths}mo`;
}

function appendMetaItem(meta: HTMLElement, content: Node | string): void {
  if (meta.childElementCount > 0) {
    const sep = document.createElement("span");
    sep.className = "bon-profile-info__sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "·";
    meta.appendChild(sep);
  }

  const item = document.createElement("span");
  item.className = "bon-profile-info__meta-item";

  if (typeof content === "string") {
    item.textContent = content;
  } else {
    item.appendChild(content);
  }

  meta.appendChild(item);
}

export function bonReportsProfileSection(
  report: ReportRow,
  actions: HTMLElement[] = []
): HTMLDivElement {
  const { username, createdAt, totalKarma, ringId, investigation } = report;

  if (createdAt === null || totalKarma === null) {
    void bonFetchAndStoreProfileStats(username);
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap bon-profile-info";

  const header = document.createElement("div");
  header.className = "bon-profile-info__header";

  const identity = document.createElement("div");
  identity.className = "bon-profile-info__identity";

  const titleRow = document.createElement("div");
  titleRow.className = "bon-profile-info__title-row";

  const link = document.createElement("a");
  link.className = "bon-profile-info__username";
  link.href = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `u/${username}`;
  titleRow.appendChild(link);

  const regionBadge = bonReportsRegionBadge(report);
  if (regionBadge) {
    titleRow.appendChild(regionBadge);
  }

  const demographicsBadge = bonReportsDemographicsBadge(report);
  if (demographicsBadge) {
    titleRow.appendChild(demographicsBadge);
  }

  const verdictBadge = bonReportsVerdictBadge(investigation, !!ringId);
  if (verdictBadge) {
    titleRow.appendChild(verdictBadge);
  }

  identity.appendChild(titleRow);

  const meta = document.createElement("div");
  meta.className = "bon-profile-info__meta";

  if (createdAt) {
    const cake = document.createElement("span");
    cake.className = "bon-profile-info__cake";
    cake.title = `Cake day: ${formatCakeDay(createdAt)}`;

    const icon = document.createElement("span");
    icon.className = "bon-profile-info__cake-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🎂";
    cake.appendChild(icon);

    const age = document.createElement("span");
    age.textContent = formatAccountAge(createdAt);
    cake.appendChild(age);

    appendMetaItem(meta, cake);
  } else {
    const pending = document.createElement("span");
    pending.className = "bon-profile-info__pending";
    pending.textContent = "Fetching profile…";
    appendMetaItem(meta, pending);
  }

  if (typeof totalKarma === "number") {
    const karma = document.createElement("span");
    karma.title = `${totalKarma.toLocaleString()} karma`;
    karma.textContent = `${formatKarma(totalKarma)} karma`;
    appendMetaItem(meta, karma);
  }

  if (investigation && investigation.status === "done") {
    const posts = investigation.results.postsFetched;
    const comments = investigation.results.commentsFetched;
    const contributions = posts + comments;
    if (contributions > 0) {
      const item = document.createElement("span");
      item.title = `${posts} post${posts === 1 ? "" : "s"} · ${comments} comment${comments === 1 ? "" : "s"} visible on profile`;
      item.textContent = `${contributions.toLocaleString()} contribution${contributions === 1 ? "" : "s"}`;
      appendMetaItem(meta, item);
    }
  }

  const reportsCount = report.count || 0;
  const noun = reportsCount === 1 ? "report" : "reports";
  const reportsText = report.lastReportedAt
    ? `${reportsCount} ${noun} · last ${bonFormatDate(report.lastReportedAt)}`
    : `${reportsCount} ${noun}`;
  appendMetaItem(meta, reportsText);

  identity.appendChild(meta);
  header.appendChild(identity);

  if (actions.length > 0) {
    const actionsRow = document.createElement("div");
    actionsRow.className = "bon-profile-info__actions";

    for (const action of actions) {
      actionsRow.appendChild(action);
    }

    header.appendChild(actionsRow);
  }

  wrap.appendChild(header);

  return wrap;
}
