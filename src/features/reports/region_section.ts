// "Region" section in the detail pane — surfaces the inferred region
// prominently (big flag + label) plus the supporting reasons that led to
// the pick (country-coded subs, script in writing, language markers,
// moderated subs, posting-timezone match). Sits between the AI
// investigation and the activity heatmap so it's clear the region pick
// is informed by everything we've learned about the account, not just
// the timeline.

import { BON_REGION_INFO } from "../regions/data.ts";
import {
  bonRegionForOffset,
  type AiRegionInference,
  type LanguageInference,
  type ModeratedInference,
  type ScriptInference,
  type SubregionInference,
} from "../regions";
import { bonPad2 } from "../../utils/format_time.ts";
import type { ReportRow } from "./logic.ts";
import {
  bonReportsComputeRegionForReport,
  bonReportsInferTimezoneFromTimestamps,
  type TimezoneInference,
} from "./region.ts";

type ReasonTone = "supporting" | "against";

interface Reason {
  tone: ReasonTone;
  text: string;
}

function reasonSubreddit(subRegion: SubregionInference): Reason {
  const info = BON_REGION_INFO[subRegion.region];
  const label = info?.label || subRegion.region;
  const hits = subRegion.hits
    .slice(0, 3)
    .map(({ sub, count }) => `r/${sub}${count > 1 ? ` ×${count}` : ""}`)
    .join(", ");
  const more =
    subRegion.hits.length > 3 ? ` +${subRegion.hits.length - 3} more` : "";

  return {
    tone: "supporting",
    text: `${subRegion.count} post${subRegion.count === 1 ? "" : "s"} in ${label}-coded subs: ${hits}${more}`,
  };
}

function reasonScript(scriptRegion: ScriptInference): Reason {
  const hits = scriptRegion.hits
    .map((hit) => `${hit.count} ${hit.script}`)
    .join(", ");

  return {
    tone: "supporting",
    text: `Non-Latin script in their writing: ${hits}`,
  };
}

function reasonLanguage(langRegion: LanguageInference): Reason {
  const hits = langRegion.hits
    .map((hit) => {
      const samples = hit.samples.length
        ? ` ("${hit.samples.join('", "')}")`
        : "";

      return `${hit.count} ${hit.label}${samples}`;
    })
    .join("; ");

  return {
    tone: "supporting",
    text: `Language markers in writing: ${hits}`,
  };
}

function reasonModerator(modRegion: ModeratedInference): Reason {
  const info = BON_REGION_INFO[modRegion.region];
  const label = info?.label || modRegion.region;
  const list = modRegion.hits
    .slice(0, 3)
    .map((hit) => `r/${hit.sub}`)
    .join(", ");
  const more =
    modRegion.hits.length > 3 ? ` +${modRegion.hits.length - 3} more` : "";

  return {
    tone: "supporting",
    text: `Moderates ${modRegion.score} ${label}-coded sub${modRegion.score === 1 ? "" : "s"}: ${list}${more}`,
  };
}

function reasonTimezoneMatch(
  inferred: TimezoneInference,
  matchedRegionLabel: string
): Reason | null {
  if (inferred.kind !== "inferred") {
    return null;
  }

  const { offsetHours, sleepStartUtc, sleepEndUtc } = inferred;
  const offsetStr = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
  const sleep = `${bonPad2(sleepStartUtc)}:00–${bonPad2(sleepEndUtc)}:00 UTC`;
  return {
    tone: "supporting",
    text: `Posting timezone ${offsetStr} (inactive ${sleep}) matches ${matchedRegionLabel}`,
  };
}

function reasonTimezoneMismatch(
  inferred: TimezoneInference,
  pickedRegionLabel: string
): Reason | null {
  if (inferred.kind !== "inferred") {
    return null;
  }

  const info = Object.values(BON_REGION_INFO).find(
    (entry) => entry.label === pickedRegionLabel
  );

  if (!info || info.utcOffsets.includes(inferred.offsetHours)) {
    return null;
  }

  const offsetStr = `UTC${inferred.offsetHours >= 0 ? "+" : ""}${inferred.offsetHours}`;
  const tzBand = bonRegionForOffset(inferred.offsetHours);
  return {
    tone: "against",
    text: `Posting timezone ${offsetStr}${tzBand ? ` (${tzBand})` : ""} — not the typical sleep cycle for ${pickedRegionLabel}; could mean a VPN, recent move, or operator running this account from elsewhere`,
  };
}

function reasonRunnerUp(
  runnerUp: { region: string; score: number },
  pickedScore: number
): Reason {
  const info = BON_REGION_INFO[runnerUp.region];
  const label = info?.label || runnerUp.region;
  const flag = info?.flag || "🏳";
  return {
    tone: "against",
    text: `Runner-up: ${flag} ${label} (score ${runnerUp.score.toFixed(1)} vs. ${pickedScore.toFixed(1)})`,
  };
}

function renderHeadline(
  flag: string,
  label: string,
  subtitle: string
): HTMLDivElement {
  const headline = document.createElement("div");
  headline.className = "bon-region-headline";

  const flagEl = document.createElement("span");
  flagEl.className = "bon-region-headline-flag";
  flagEl.textContent = flag;
  flagEl.title = label;
  headline.appendChild(flagEl);

  const text = document.createElement("div");
  text.className = "bon-region-headline-text";

  const labelEl = document.createElement("div");
  labelEl.className = "bon-region-headline-label";
  labelEl.textContent = label;
  text.appendChild(labelEl);

  const subEl = document.createElement("div");
  subEl.className = "bon-region-headline-sub";
  subEl.textContent = subtitle;
  text.appendChild(subEl);

  headline.appendChild(text);
  return headline;
}

function renderReasons(reasons: Reason[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "bon-region-reasons";

  for (const reason of reasons) {
    const item = document.createElement("li");
    item.className = `bon-region-reason bon-region-reason--${reason.tone}`;
    item.textContent = reason.text;
    list.appendChild(item);
  }

  return list;
}

function renderAiSection(
  wrap: HTMLDivElement,
  ai: AiRegionInference
): HTMLDivElement {
  const info = BON_REGION_INFO[ai.region] || {
    flag: "🏳",
    label: ai.region,
    utcOffsets: [],
  };

  const subtitle = ai.confidence
    ? `AI investigation pick · ${Math.round(ai.confidence * 100)}% confidence`
    : "AI investigation pick";

  wrap.appendChild(renderHeadline(info.flag, info.label, subtitle));

  const reasons: Reason[] = [];
  if (ai.reasoning) {
    reasons.push({ tone: "supporting", text: ai.reasoning });
  }

  const deterministic = ai.deterministic;

  if (deterministic?.kind === "deterministic") {
    if (deterministic.region === ai.region) {
      const supports: string[] = [];

      if (deterministic.subreddit) {
        supports.push(reasonSubreddit(deterministic.subreddit).text);
      }

      if (deterministic.scriptSignal) {
        supports.push(reasonScript(deterministic.scriptSignal).text);
      }

      if (deterministic.languageSignal) {
        supports.push(reasonLanguage(deterministic.languageSignal).text);
      }

      if (deterministic.moderator) {
        supports.push(reasonModerator(deterministic.moderator).text);
      }

      for (const text of supports) {
        reasons.push({ tone: "supporting", text: `Also: ${text}` });
      }
    } else {
      const otherInfo = BON_REGION_INFO[deterministic.region];
      const otherLabel = otherInfo?.label || deterministic.region;
      reasons.push({
        tone: "against",
        text: `Deterministic signals point to ${otherLabel} — could be a VPN, a recent move, or the AI is wrong. Worth a manual look.`,
      });
    }
  }

  if (reasons.length > 0) {
    wrap.appendChild(renderReasons(reasons));
  }

  return wrap;
}

export function bonReportsRegionSection(report: ReportRow): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Region";
  wrap.appendChild(title);

  if (!report.activityData) {
    const empty = document.createElement("p");
    empty.className = "bon-heatmap-empty";
    empty.textContent =
      "Investigate this user to infer region (country-coded subs, scripts, language markers, moderated subs, posting timezone).";
    wrap.appendChild(empty);
    return wrap;
  }

  const timestamps = [
    ...(report.activityData.postTimestamps || []),
    ...(report.activityData.commentTimestamps || []),
  ];
  const timezone = bonReportsInferTimezoneFromTimestamps(timestamps);

  const combined = bonReportsComputeRegionForReport(report);

  if (combined?.kind === "ai") {
    return renderAiSection(wrap, combined);
  }

  if (!combined) {
    wrap.appendChild(
      renderHeadline(
        "❓",
        "Unknown",
        "No country-coded subs, scripts, language markers, moderated subs, or clear sleep cycle found in this account's recent activity."
      )
    );

    return wrap;
  }

  if (combined.kind === "timezone-only") {
    const offsetStr = `UTC${combined.offsetHours >= 0 ? "+" : ""}${combined.offsetHours}`;
    const tzBand = bonRegionForOffset(combined.offsetHours);
    const candidates = combined.possibleRegions
      .map((code) => BON_REGION_INFO[code]?.label)
      .filter((label): label is string => Boolean(label))
      .slice(0, 6);

    wrap.appendChild(
      renderHeadline(
        "🕓",
        offsetStr,
        tzBand
          ? `Posting hours suggest ${tzBand}`
          : "Posting hours suggest this offset"
      )
    );

    if (candidates.length > 0) {
      wrap.appendChild(
        renderReasons([
          {
            tone: "supporting",
            text: `Posting timezone ${offsetStr} narrows it to: ${candidates.join(", ")}`,
          },
          {
            tone: "against",
            text: `No country-coded subs, scripts, or language markers to disambiguate further.`,
          },
        ])
      );
    }

    return wrap;
  }

  const info = BON_REGION_INFO[combined.region] || {
    flag: "🏳",
    label: combined.region,
    utcOffsets: [],
  };

  const reasons: Reason[] = [];
  if (combined.subreddit) {
    reasons.push(reasonSubreddit(combined.subreddit));
  }

  if (combined.scriptSignal) {
    reasons.push(reasonScript(combined.scriptSignal));
  }

  if (combined.languageSignal) {
    reasons.push(reasonLanguage(combined.languageSignal));
  }

  if (combined.moderator) {
    reasons.push(reasonModerator(combined.moderator));
  }

  if (combined.tzMatch === true) {
    const tzReason = reasonTimezoneMatch(timezone, info.label);
    if (tzReason) {
      reasons.push(tzReason);
    }
  }

  const supportingCount = reasons.filter(
    (reason) => reason.tone === "supporting"
  ).length;

  const tzMismatch = reasonTimezoneMismatch(timezone, info.label);
  if (tzMismatch) {
    reasons.push(tzMismatch);
  }

  if (combined.runnerUp) {
    reasons.push(reasonRunnerUp(combined.runnerUp, combined.score));
  }

  const subtitle =
    supportingCount === 1
      ? "1 supporting signal"
      : `${supportingCount} supporting signals agree`;

  wrap.appendChild(renderHeadline(info.flag, info.label, subtitle));
  wrap.appendChild(renderReasons(reasons));

  return wrap;
}
