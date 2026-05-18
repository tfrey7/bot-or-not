// "Activity heatmap" section — fetches and renders the calendar + hour
// heatmap. The "Load activity" button is only shown when no activity data
// has been fetched yet; afterward a small ↻ refresh button hides in the
// meta line. The API-limit banner warns when Reddit only returned the
// most recent N items and older activity is unknowable from the API.

import type { ActivityData } from "../../types.ts";
import { bonReportsCalendarHeatmap } from "./calendar_heatmap.ts";
import { bonReportsHourSection } from "./hour_heatmap.ts";
import type { ReportRow } from "./logic.ts";

function renderActivityRefresh(
  username: string,
  activityData: ActivityData | null,
  standalone: boolean
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bon-heatmap-refresh";
  const ts = activityData?.fetchedAt
    ? new Date(activityData.fetchedAt).toLocaleString()
    : "";
  btn.textContent = standalone ? "↻ Refresh" : "↻ refresh";
  btn.title = ts ? `Fetched ${ts}` : "Refresh from Reddit";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "refreshing…";
    try {
      await browser.runtime.sendMessage({
        type: "fetch-activity",
        username,
      });
      // storage.onChanged will re-render.
    } catch (err) {
      console.error("[Bot or Not] refresh failed", err);
      btn.disabled = false;
      btn.textContent = standalone ? "↻ Refresh" : "↻ refresh";
    }
  });
  return btn;
}

function renderApiLimitBanner(
  activityData: ActivityData
): HTMLDivElement | null {
  const { postsLimited, commentsLimited } = activityData;
  if (!postsLimited && !commentsLimited) {
    return null;
  }

  const div = document.createElement("div");
  div.className = "bon-heatmap-banner";
  const limitedKinds: string[] = [];
  if (postsLimited) {
    limitedKinds.push("posts");
  }
  if (commentsLimited) {
    limitedKinds.push("comments");
  }
  const limitedText = limitedKinds.join(" and ");
  const earliestVisible = (() => {
    const bounds: number[] = [];
    if (postsLimited && activityData.earliestPostAt) {
      bounds.push(activityData.earliestPostAt);
    }
    if (commentsLimited && activityData.earliestCommentAt) {
      bounds.push(activityData.earliestCommentAt);
    }
    return bounds.length ? Math.max(...bounds) : null;
  })();
  const dateText = earliestVisible
    ? new Date(earliestVisible).toLocaleDateString()
    : null;
  const lead = `⚠ Reddit returned the most recent ${activityData.fetchLimit || 100} ${limitedText} only.`;
  const tail = dateText
    ? ` Activity before ${dateText} may be undercounted — what looks like dormancy could just be data older than the API window.`
    : " Older activity may be missing from the heatmap.";
  div.textContent = lead + tail;
  return div;
}

export function bonReportsActivitySection(report: ReportRow): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Activity heatmap";
  wrap.appendChild(title);

  const { username, activityData } = report;

  if (!activityData) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bon-heatmap-load";
    btn.textContent = "📊 Load activity";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Loading…";
      try {
        const res = (await browser.runtime.sendMessage({
          type: "fetch-activity",
          username,
        })) as { ok?: boolean; error?: string };
        if (res?.ok === false) {
          btn.disabled = false;
          btn.textContent = "📊 Load activity";
          const err = document.createElement("p");
          err.className = "bon-heatmap-empty";
          err.style.color = "var(--bon-danger)";
          err.textContent = `Failed to load: ${res.error || "Unknown error"}`;
          wrap.appendChild(err);
        }
        // storage.onChanged will trigger a re-render on success.
      } catch (err) {
        console.error("[Bot or Not] fetch-activity failed", err);
        btn.disabled = false;
        btn.textContent = "📊 Load activity";
      }
    });
    wrap.appendChild(btn);
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
    wrap.appendChild(renderActivityRefresh(username, activityData, true));
    return wrap;
  }

  const banner = renderApiLimitBanner(activityData);
  if (banner) {
    wrap.appendChild(banner);
  }

  const meta = document.createElement("p");
  meta.className = "bon-heatmap-row";
  const postsCount = (activityData.postTimestamps || []).length;
  const commentsCount = (activityData.commentTimestamps || []).length;
  const postsLabel = postsCount === 1 ? "post" : "posts";
  const commentsLabel = commentsCount === 1 ? "comment" : "comments";
  const countSpan = document.createElement("span");
  const ps = document.createElement("strong");
  ps.textContent = String(postsCount);
  const cs = document.createElement("strong");
  cs.textContent = String(commentsCount);
  countSpan.append(ps, ` ${postsLabel} · `, cs, ` ${commentsLabel}`);
  meta.appendChild(countSpan);
  const earliest = timestamps[0];
  const earliestSpan = document.createElement("span");
  earliestSpan.textContent = `oldest visible: ${new Date(earliest).toLocaleDateString()}`;
  meta.appendChild(earliestSpan);
  meta.appendChild(renderActivityRefresh(username, activityData, false));
  wrap.appendChild(meta);

  wrap.appendChild(bonReportsCalendarHeatmap(timestamps, activityData));
  wrap.appendChild(bonReportsHourSection(timestamps, activityData));

  return wrap;
}

export function bonReportsActivityLoadingPlaceholder(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";
  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Activity heatmap";
  wrap.appendChild(title);
  const loading = document.createElement("p");
  loading.className = "bon-heatmap-empty";
  loading.textContent = "Loading activity…";
  wrap.appendChild(loading);
  return wrap;
}
