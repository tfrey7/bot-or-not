// Region badge in the "Region" column. Deterministic regions get the
// flag + label; timezone-only inferences fall back to a muted "UTC+N"
// chip. The tooltip enumerates every signal source that contributed so
// the operator can audit the pick.

import { BON_REGION_INFO, type RegionInfo } from "../regions/data.ts";
import type { DeterministicRegionInference } from "../regions/index.ts";
import { bonReportsComputeRegionForReport, type ReportRow } from "./logic.ts";

function formatRegionTooltip(
  region: DeterministicRegionInference,
  info: RegionInfo
): string {
  const lines = [`${info.label} — combined region signal:`];

  if (region.subreddit) {
    const hitsSummary = region.subreddit.hits
      .slice(0, 4)
      .map(({ sub, count }) => `r/${sub}${count > 1 ? ` ×${count}` : ""}`)
      .join(", ");

    const more =
      region.subreddit.hits.length > 4
        ? ` +${region.subreddit.hits.length - 4} more`
        : "";

    lines.push(
      `• ${region.subreddit.count} item${region.subreddit.count === 1 ? "" : "s"} in ${info.label}-coded subreddits (${hitsSummary}${more})`
    );
  }

  if (region.scriptSignal) {
    const scriptSummary = region.scriptSignal.hits
      .map((h) => `${h.count} ${h.script}`)
      .join(", ");

    lines.push(`• Script in their writing: ${scriptSummary}`);
  }

  if (region.languageSignal) {
    const langSummary = region.languageSignal.hits
      .map((h) => `${h.count} ${h.label}`)
      .join(", ");

    lines.push(`• Language markers in their writing: ${langSummary}`);
  }

  if (region.moderator) {
    const modList = region.moderator.hits
      .slice(0, 3)
      .map((h) => `r/${h.sub}`)
      .join(", ");

    lines.push(
      `• Moderates ${region.moderator.score} ${info.label}-coded sub${region.moderator.score === 1 ? "" : "s"} (${modList})`
    );
  }

  if (region.tzMatch === true && region.tzOffset != null) {
    lines.push(
      `• Posting timezone UTC${region.tzOffset >= 0 ? "+" : ""}${region.tzOffset} matches ${info.label}`
    );
  } else if (region.tzMatch === false && region.tzOffset != null) {
    lines.push(
      `⚠ Posting timezone UTC${region.tzOffset >= 0 ? "+" : ""}${region.tzOffset} does NOT match — possible operator in a different country`
    );
  }

  if (region.runnerUp) {
    const r = BON_REGION_INFO[region.runnerUp.region];
    lines.push(
      `(runner-up: ${r?.label || region.runnerUp.region} with score ${region.runnerUp.score.toFixed(1)})`
    );
  }

  return lines.join("\n");
}

export function bonReportsRegionBadge(report: ReportRow): HTMLSpanElement {
  const region = bonReportsComputeRegionForReport(report);

  if (!region) {
    const dash = document.createElement("span");
    dash.className = "bon-bb-empty";
    dash.textContent = "—";

    if (!report.activityData) {
      dash.title =
        "Activity not loaded yet — expand the row or run an investigation to populate.";
    } else if (!report.activityData.subredditCounts) {
      dash.title =
        "Activity data was fetched before subreddit-region tracking was added. Click ↻ refresh in the heatmap to re-fetch and populate this column.";
    } else {
      dash.title =
        "No region-specific subreddits in this account's recent activity, and no clear daily sleep cycle for timezone inference.";
    }

    return dash;
  }

  if (region.kind === "deterministic") {
    const info: RegionInfo = BON_REGION_INFO[region.region] || {
      flag: "🏳",
      label: region.region,
      utcOffsets: [],
    };

    const badge = document.createElement("span");

    let tzClass = "";
    if (region.tzMatch === true) {
      tzClass = " bon-region-badge--tz-match";
    } else if (region.tzMatch === false) {
      tzClass = " bon-region-badge--tz-mismatch";
    }
    badge.className = `bon-region-badge${tzClass}`;

    const flag = document.createElement("span");
    flag.className = "bon-region-flag";
    flag.textContent = info.flag;
    flag.title = info.label;
    badge.appendChild(flag);

    const label = document.createElement("span");
    label.textContent = info.label;
    badge.appendChild(label);

    badge.title = formatRegionTooltip(region, info);
    return badge;
  }

  const span = document.createElement("span");
  span.className = "bon-region-tz-only";

  const offset = region.offsetHours;
  const sign = offset >= 0 ? "+" : "";
  span.textContent = `UTC${sign}${offset}`;

  const candidates = region.possibleRegions
    .map((code) => BON_REGION_INFO[code]?.label)
    .filter((l): l is string => Boolean(l));

  span.title = candidates.length
    ? `Timezone-only inference. Posting hours cluster around UTC${sign}${offset} — possible regions: ${candidates.join(", ")}. No country-coded subreddits in activity.`
    : `Timezone-only inference. Posting hours cluster around UTC${sign}${offset}. No country-coded subreddits in activity.`;

  return span;
}
