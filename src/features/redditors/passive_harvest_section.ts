// "Passively-harvested content" panel in the detail pane. Mirrors the
// Google dossier section — same visual shape (title row + sub-chips +
// expandable item list) — but the items come from Reddit's DOM, not a
// SERP, and only for accounts we've already flagged as profileHidden.
//
// Also surfaces a staleness badge when new items have arrived since the
// last investigation ran. Re-investigation is intentionally manual (it
// costs money); the badge is the prompt to do it.

import type { PassiveHarvest, PassiveHarvestItem } from "../../types.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import { bonInvestigationResults } from "../../utils/history.ts";
import type { ReportRow } from "./logic.ts";

const ITEM_LIMIT = 30;
const BODY_CLIP = 280;

export function bonRedditorsPassiveHarvestSection(
  report: ReportRow
): HTMLDivElement | null {
  const harvest = report.passiveHarvest;
  if (!harvest || harvest.items.length === 0) {
    return null;
  }

  const lastRunAt = bonInvestigationResults(report.investigation)?.runAt ?? 0;
  const freshItems = bonRedditorsPassiveHarvestCountFresh(harvest, lastRunAt);

  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap bon-passive-harvest";

  wrap.appendChild(buildTitleRow(harvest, freshItems));

  const aggregates = buildAggregates(harvest);
  if (aggregates) {
    wrap.appendChild(aggregates);
  }

  wrap.appendChild(buildItemsDisclosure(harvest.items, lastRunAt));

  return wrap;
}

// Items captured strictly after the most recent investigation ran. With
// lastRunAt == 0 (no investigation yet), everything counts as fresh.
// Exported so the Investigate button can show the same number as the
// section's stale-badge without recomputing the definition independently.
export function bonRedditorsPassiveHarvestCountFresh(
  harvest: PassiveHarvest | null,
  lastRunAt: number
): number {
  if (!harvest) {
    return 0;
  }

  let n = 0;

  for (const item of harvest.items) {
    if (item.firstSeenAt > lastRunAt) {
      n++;
    }
  }

  return n;
}

function buildTitleRow(
  harvest: PassiveHarvest,
  freshItems: number
): HTMLDivElement {
  const titleRow = document.createElement("div");
  titleRow.className = "bon-passive-harvest__title-row";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Caught in feeds";
  titleRow.appendChild(title);

  if (freshItems > 0) {
    const badge = document.createElement("span");
    badge.className = "bon-passive-harvest__stale-badge";
    badge.textContent = `${freshItems} new since last analysis`;
    badge.title =
      "Re-investigate to feed these new items into the verdict. Each run costs money — your call when.";
    titleRow.appendChild(badge);
  }

  const meta = document.createElement("span");
  meta.className = "bon-passive-harvest__meta";

  const itemCount = harvest.items.length;
  const parts = [
    `${itemCount} item${itemCount === 1 ? "" : "s"}`,
    `last ${bonFormatDate(harvest.lastSeenAt)}`,
  ];

  meta.textContent = parts.join(" · ");
  meta.title =
    `First captured ${bonFormatDate(harvest.firstSeenAt)}, ` +
    `last ${bonFormatDate(harvest.lastSeenAt)}`;
  titleRow.appendChild(meta);

  return titleRow;
}

function buildAggregates(harvest: PassiveHarvest): HTMLDivElement | null {
  const subs = Object.entries(harvest.subredditDistribution).sort(
    (a, b) => b[1] - a[1]
  );

  if (subs.length === 0) {
    return null;
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-passive-harvest__aggregates";

  for (const [sub, count] of subs) {
    const chip = document.createElement("span");
    chip.className = "bon-passive-harvest__chip";
    chip.textContent = count > 1 ? `${sub} ×${count}` : sub;
    wrap.appendChild(chip);
  }

  return wrap;
}

function buildItemsDisclosure(
  items: PassiveHarvestItem[],
  lastRunAt: number
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "bon-passive-harvest__items-disclosure";

  const summary = document.createElement("summary");
  summary.className = "bon-passive-harvest__items-summary";

  const label = document.createElement("span");
  label.className = "bon-passive-harvest__items-summary-label";
  label.textContent = `Items (${items.length})`;
  summary.appendChild(label);

  details.appendChild(summary);
  details.appendChild(buildItemsList(items, lastRunAt));

  return details;
}

function buildItemsList(
  items: PassiveHarvestItem[],
  lastRunAt: number
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "bon-passive-harvest__items";

  // Most-recently-seen first so the active narrative is at the top.
  const sorted = [...items].sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  for (const item of sorted.slice(0, ITEM_LIMIT)) {
    list.appendChild(buildItem(item, lastRunAt));
  }

  if (sorted.length > ITEM_LIMIT) {
    const overflow = document.createElement("li");
    overflow.className = "bon-passive-harvest__overflow";
    overflow.textContent = `+${sorted.length - ITEM_LIMIT} more`;
    list.appendChild(overflow);
  }

  return list;
}

function buildItem(item: PassiveHarvestItem, lastRunAt: number): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "bon-passive-harvest__item";

  if (item.firstSeenAt > lastRunAt && lastRunAt > 0) {
    li.classList.add("bon-passive-harvest__item--fresh");
  }

  const titleLink = document.createElement("a");
  titleLink.className = "bon-passive-harvest__item-title";
  titleLink.href = `https://www.reddit.com${item.permalink}`;
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";

  // Posts have a title; comments don't, so fall back to the first slice
  // of body so the link surface is never empty.
  if (item.kind === "post" && item.postTitle) {
    titleLink.textContent = item.postTitle;
  } else if (item.bodyExcerpt) {
    titleLink.textContent = item.bodyExcerpt.slice(0, 80);
  } else {
    titleLink.textContent = item.permalink;
  }

  li.appendChild(titleLink);

  const metaLine = document.createElement("div");
  metaLine.className = "bon-passive-harvest__item-meta";

  const metaParts: string[] = [];
  if (item.subreddit) {
    metaParts.push(item.subreddit);
  }

  metaParts.push(item.kind);

  if (item.createdAt) {
    metaParts.push(bonFormatDate(item.createdAt));
  }

  metaLine.textContent = metaParts.join(" · ");
  metaLine.title = `First seen ${bonFormatDate(item.firstSeenAt)}`;
  li.appendChild(metaLine);

  // For posts we show the title above; the body excerpt is the
  // additional context. For comments the body IS the content — show
  // the full excerpt clipped to BODY_CLIP.
  if (item.bodyExcerpt) {
    const body = document.createElement("div");
    body.className = "bon-passive-harvest__item-body";
    body.textContent =
      item.bodyExcerpt.length > BODY_CLIP
        ? `${item.bodyExcerpt.slice(0, BODY_CLIP)}…`
        : item.bodyExcerpt;
    li.appendChild(body);
  }

  return li;
}
