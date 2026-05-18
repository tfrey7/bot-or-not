// Day-of-week × hour-of-day heatmap rendered below the calendar, plus the
// region/timezone-inference lines that summarize the deterministic region
// signals the regions feature surfaced for this account.

import { BON_REGION_INFO } from "../regions/data.js";
import {
  bonInferRegionFromLanguage,
  bonInferRegionFromModerated,
  bonInferRegionFromScripts,
  bonInferRegionFromSubreddits,
  bonRegionForOffset,
} from "../regions/index.js";
import { bonBucketLevel } from "../../utils/scoring.js";
import { bonPad2 } from "../../utils/format_time.js";
import { BON_REPORTS_DAY_NAMES } from "./data.js";
import { bonReportsInferTimezoneFromTimestamps } from "./logic.js";

function renderInferredTimezone(inferred, subRegion) {
  const span = document.createElement("span");
  if (inferred.kind === "insufficient") {
    span.innerHTML = `<small>Not enough activity to infer a timezone (${inferred.count} item${inferred.count === 1 ? "" : "s"}).</small>`;
    return span;
  }
  if (inferred.kind === "flat") {
    span.innerHTML = `⚠ <strong>No clear daily cycle</strong> — activity is spread evenly across 24 hours UTC. Possible bot, shared account, or multi-region operator.`;
    return span;
  }
  const { offsetHours, sleepStartUtc, sleepEndUtc } = inferred;
  const offsetStr = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
  const region = bonRegionForOffset(offsetHours);
  const sleep = `${bonPad2(sleepStartUtc)}:00–${bonPad2(sleepEndUtc)}:00 UTC`;
  let suffix = "";
  if (subRegion) {
    const info = BON_REGION_INFO[subRegion.region];
    const offsets = info?.utcOffsets || [];
    if (offsets.includes(offsetHours)) {
      suffix = ` — <strong style="color:#16a085">matches ${info.label} posting history ✓</strong>`;
    } else {
      suffix = ` — <strong style="color:#c0392b">does NOT match ${info?.label || subRegion.region} posting history ⚠</strong>`;
    }
  }
  span.innerHTML = `Likely profile timezone: <strong>${offsetStr}</strong>${region ? ` (${region})` : ""} — inactive window ${sleep}${suffix}`;
  return span;
}

function renderSubredditRegionLine(subRegion) {
  const info = BON_REGION_INFO[subRegion.region] || {
    flag: "🏳",
    label: subRegion.region,
  };
  const span = document.createElement("span");
  const hitsList = subRegion.hits
    .slice(0, 5)
    .map(({ sub, count }) => `r/${sub}${count > 1 ? ` ×${count}` : ""}`)
    .join(", ");
  const moreNote =
    subRegion.hits.length > 5
      ? ` <span class="bon-region-tz">+${subRegion.hits.length - 5} more</span>`
      : "";
  let runnerNote = "";
  if (subRegion.runnerUp) {
    const r = BON_REGION_INFO[subRegion.runnerUp.region];
    runnerNote = ` <span class="bon-region-tz">(also ${subRegion.runnerUp.count} in ${r?.label || subRegion.runnerUp.region})</span>`;
  }
  span.innerHTML = `Region from posting history: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${subRegion.count} item${subRegion.count === 1 ? "" : "s"} in ${hitsList}${moreNote}${runnerNote}`;
  return span;
}

function renderScriptRegionLine(scriptRegion) {
  const info = BON_REGION_INFO[scriptRegion.region] || {
    flag: "🏳",
    label: scriptRegion.region,
  };
  const span = document.createElement("span");
  const hits = scriptRegion.hits
    .map((h) => `${h.count} ${h.script}`)
    .join(", ");
  span.innerHTML = `Script in their writing: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${hits}`;
  return span;
}

function renderLanguageRegionLine(langRegion) {
  const info = BON_REGION_INFO[langRegion.region] || {
    flag: "🏳",
    label: langRegion.region,
  };
  const span = document.createElement("span");
  const hits = langRegion.hits.map((h) => `${h.count} ${h.label}`).join(", ");
  span.innerHTML = `Language markers in writing: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${hits}`;
  return span;
}

function renderModeratorRegionLine(modRegion) {
  const info = BON_REGION_INFO[modRegion.region] || {
    flag: "🏳",
    label: modRegion.region,
  };
  const span = document.createElement("span");
  const list = modRegion.hits
    .slice(0, 5)
    .map((h) => `r/${h.sub}`)
    .join(", ");
  const more =
    modRegion.hits.length > 5
      ? ` <span class="bon-region-tz">+${modRegion.hits.length - 5} more</span>`
      : "";
  span.innerHTML = `Moderates ${modRegion.score} ${info.label}-coded sub${modRegion.score === 1 ? "" : "s"}: <strong title="${info.label}">${info.flag} ${info.label}</strong> — ${list}${more}`;
  return span;
}

function renderHourHeatmap(timestamps) {
  // 7 (day of week) x 24 (hour of day) buckets in the viewer's local timezone.
  const counts = new Array(7 * 24).fill(0);
  for (const t of timestamps) {
    const local = new Date(t);
    const dow = local.getDay();
    const hour = local.getHours();
    counts[dow * 24 + hour]++;
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-hour";

  const dayLabels = document.createElement("div");
  dayLabels.className = "bon-hour-days";
  for (let i = 0; i < 7; i++) {
    const d = document.createElement("div");
    d.textContent = BON_REPORTS_DAY_NAMES[i];
    dayLabels.appendChild(d);
  }
  wrap.appendChild(dayLabels);

  const right = document.createElement("div");
  right.className = "bon-hour-right";

  const hourLabels = document.createElement("div");
  hourLabels.className = "bon-hour-hours";
  for (let h = 0; h < 24; h++) {
    const s = document.createElement("span");
    s.textContent = h % 6 === 0 ? String(h) : "";
    hourLabels.appendChild(s);
  }
  right.appendChild(hourLabels);

  const grid = document.createElement("div");
  grid.className = "bon-hour-grid";
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = document.createElement("div");
      cell.className = "bon-hour-cell";
      const c = counts[d * 24 + h];
      const lvl = bonBucketLevel(c);
      if (lvl > 0) {
        cell.classList.add(`bon-heatmap-cell--lvl${lvl}`);
      }
      cell.title = `${BON_REPORTS_DAY_NAMES[d]} ${String(h).padStart(2, "0")}:00 — ${c} item${c === 1 ? "" : "s"}`;
      grid.appendChild(cell);
    }
  }
  right.appendChild(grid);
  wrap.appendChild(right);
  return wrap;
}

export function bonReportsHourSection(timestamps, activityData) {
  const outer = document.createElement("div");
  outer.style.marginTop = "0.75em";

  // Surface every deterministic signal source independently so the operator
  // can see which ones fired (subreddit / script / language markers /
  // moderated subs) — not just the combined verdict.
  const subRegion = bonInferRegionFromSubreddits(activityData?.subredditCounts);
  const scriptRegion = bonInferRegionFromScripts(activityData?.scriptSignals);
  const langRegion = bonInferRegionFromLanguage(activityData?.languageSignals);
  const modRegion = bonInferRegionFromModerated(activityData?.moderatedSubs);

  if (subRegion) {
    const row = document.createElement("p");
    row.className = "bon-heatmap-row";
    row.appendChild(renderSubredditRegionLine(subRegion));
    outer.appendChild(row);
  }
  if (scriptRegion) {
    const row = document.createElement("p");
    row.className = "bon-heatmap-row";
    row.appendChild(renderScriptRegionLine(scriptRegion));
    outer.appendChild(row);
  }
  if (langRegion) {
    const row = document.createElement("p");
    row.className = "bon-heatmap-row";
    row.appendChild(renderLanguageRegionLine(langRegion));
    outer.appendChild(row);
  }
  if (modRegion) {
    const row = document.createElement("p");
    row.className = "bon-heatmap-row";
    row.appendChild(renderModeratorRegionLine(modRegion));
    outer.appendChild(row);
  }

  const inferred = bonReportsInferTimezoneFromTimestamps(timestamps);
  const primary = document.createElement("p");
  primary.className = "bon-heatmap-row";
  primary.appendChild(renderInferredTimezone(inferred, subRegion));
  outer.appendChild(primary);

  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const advisory = document.createElement("p");
  advisory.className = "bon-heatmap-row bon-heatmap-advisory";
  advisory.innerHTML = `<small>Heatmap below uses your local timezone (<strong>${tzName}</strong>) for reference.</small>`;
  outer.appendChild(advisory);

  outer.appendChild(renderHourHeatmap(timestamps));
  return outer;
}
