// Day-of-week × hour-of-day heatmap rendered below the calendar, plus the
// observational notes about the posting cycle itself (flat-across-24h
// warning, insufficient-data note, viewer-timezone advisory). Region
// inference lives in region_section.ts — this file is only about *when*
// the account posts, not *where*.

import { bonBucketLevel } from "../../utils/scoring.ts";
import { BON_REPORTS_DAY_NAMES } from "./data.ts";
import {
  bonReportsInferTimezoneFromTimestamps,
  type TimezoneInference,
} from "./region.ts";

function renderCycleNote(inferred: TimezoneInference): HTMLSpanElement | null {
  if (inferred.kind === "insufficient") {
    const span = document.createElement("span");
    span.innerHTML = `<small>Not enough activity to infer a sleep cycle (${inferred.count} item${inferred.count === 1 ? "" : "s"}).</small>`;
    return span;
  }

  if (inferred.kind === "flat") {
    const span = document.createElement("span");
    span.innerHTML = `⚠ <strong>No clear daily cycle</strong> — activity is spread evenly across 24 hours UTC. Possible bot, shared account, or multi-region operator.`;
    return span;
  }

  return null;
}

function renderHourHeatmap(timestamps: number[]): HTMLDivElement {
  // 7 (day of week) x 24 (hour of day) buckets in the viewer's local timezone.
  const counts = new Array<number>(7 * 24).fill(0);

  for (const timestamp of timestamps) {
    const local = new Date(timestamp);
    const dayOfWeek = local.getDay();
    const hour = local.getHours();
    counts[dayOfWeek * 24 + hour]++;
  }

  const wrap = document.createElement("div");
  wrap.className = "bon-hour";

  const dayLabels = document.createElement("div");
  dayLabels.className = "bon-hour-days";

  for (let i = 0; i < 7; i++) {
    const label = document.createElement("div");
    label.textContent = BON_REPORTS_DAY_NAMES[i];
    dayLabels.appendChild(label);
  }

  wrap.appendChild(dayLabels);

  const right = document.createElement("div");
  right.className = "bon-hour-right";

  const hourLabels = document.createElement("div");
  hourLabels.className = "bon-hour-hours";

  for (let h = 0; h < 24; h++) {
    const label = document.createElement("span");
    label.textContent = h % 6 === 0 ? String(h) : "";
    hourLabels.appendChild(label);
  }

  right.appendChild(hourLabels);

  const grid = document.createElement("div");
  grid.className = "bon-hour-grid";

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = document.createElement("div");
      cell.className = "bon-hour-cell";

      const count = counts[d * 24 + h];
      const level = bonBucketLevel(count);
      if (level > 0) {
        cell.classList.add(`bon-heatmap-cell--lvl${level}`);
      }

      cell.title = `${BON_REPORTS_DAY_NAMES[d]} ${String(h).padStart(2, "0")}:00 — ${count} item${count === 1 ? "" : "s"}`;
      grid.appendChild(cell);
    }
  }

  right.appendChild(grid);

  wrap.appendChild(right);
  return wrap;
}

export function bonReportsHourSection(timestamps: number[]): HTMLDivElement {
  const outer = document.createElement("div");
  outer.style.marginTop = "0.75em";

  const inferred = bonReportsInferTimezoneFromTimestamps(timestamps);
  const cycleNote = renderCycleNote(inferred);
  if (cycleNote) {
    const row = document.createElement("p");
    row.className = "bon-heatmap-row";
    row.appendChild(cycleNote);
    outer.appendChild(row);
  }

  outer.appendChild(renderHourHeatmap(timestamps));
  return outer;
}
