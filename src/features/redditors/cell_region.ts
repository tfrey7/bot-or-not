// Region badge in the "Region" column. AI-picked regions get the flag +
// label with the model's reasoning surfaced as a tooltip; deterministic
// regions get the flag + label plus the per-signal breakdown; timezone-
// only inferences fall back to a muted "UTC+N" chip. The tooltip
// enumerates every signal source that contributed so the operator can
// audit the pick.

import {
  REGION_INFO,
  type RegionInfo,
  type AiRegionInference,
  type DeterministicRegionInference,
} from "../regions";
import type { ReportRow } from "./logic.ts";
import { redditorsComputeRegionForReport } from "./region.ts";

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
      .map((hit) => `${hit.count} ${hit.script}`)
      .join(", ");

    lines.push(`• Script in their writing: ${scriptSummary}`);
  }

  if (region.languageSignal) {
    const langSummary = region.languageSignal.hits
      .map((hit) => `${hit.count} ${hit.label}`)
      .join(", ");

    lines.push(`• Language markers in their writing: ${langSummary}`);
  }

  if (region.moderator) {
    const modList = region.moderator.hits
      .slice(0, 3)
      .map((hit) => `r/${hit.sub}`)
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
    const runnerInfo = REGION_INFO[region.runnerUp.region];
    lines.push(
      `(runner-up: ${runnerInfo?.label || region.runnerUp.region} with score ${region.runnerUp.score.toFixed(1)})`
    );
  }

  return lines.join("\n");
}

function buildAiBadge(region: AiRegionInference): HTMLSpanElement {
  const info: RegionInfo = REGION_INFO[region.region] || {
    flag: "🏳",
    label: region.region,
    utcOffsets: [],
  };

  const deterministicMismatch =
    region.deterministic?.kind === "deterministic" &&
    region.deterministic.region !== region.region;

  const badge = document.createElement("span");
  badge.className = `bon-region-badge${deterministicMismatch ? " bon-region-badge--tz-mismatch" : ""}`;

  const flag = document.createElement("span");
  flag.className = "bon-region-flag";
  flag.textContent = info.flag;
  flag.title = info.label;
  badge.appendChild(flag);

  const label = document.createElement("span");
  label.textContent = info.label;
  badge.appendChild(label);

  const lines = [`${info.label} — AI investigation pick:`];
  if (region.reasoning) {
    lines.push(`• ${region.reasoning}`);
  }

  lines.push(`• Confidence ${Math.round(region.confidence * 100)}%`);

  if (deterministicMismatch && region.deterministic?.kind === "deterministic") {
    const otherInfo = REGION_INFO[region.deterministic.region];
    lines.push(
      `⚠ Deterministic signals point to ${otherInfo?.label || region.deterministic.region} (subreddit/script/language activity) — possible mismatch worth a look`
    );
  }

  badge.title = lines.join("\n");
  return badge;
}

export function redditorsRegionBadge(
  report: ReportRow
): HTMLSpanElement | null {
  const region = redditorsComputeRegionForReport(report);

  if (!region) {
    // No region inferred — leave the slot empty rather than rendering a
    // lone dash. The detail pane's Region section still surfaces the
    // "why" (activity not loaded, snapshot too old, no signals) when the
    // row is selected.
    return null;
  }

  if (region.kind === "ai") {
    return buildAiBadge(region);
  }

  if (region.kind === "deterministic") {
    const info: RegionInfo = REGION_INFO[region.region] || {
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

  // Timezone-only inference: a UTC offset alone doesn't tell the operator
  // anything actionable about region (every offset spans many countries).
  // Skip the badge rather than fill the slot with noise.
  return null;
}
