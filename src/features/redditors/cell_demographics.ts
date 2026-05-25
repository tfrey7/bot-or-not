// Demographics badge in the profile header — small chip with an age-band
// emoji + label, tooltip carrying the AI's reasoning. Sits alongside the
// region badge so age sits visually with country (the two non-verdict
// inferences Claude produces).

import type { AgeBand } from "../../types.ts";
import { investigationResults } from "../../utils/history.ts";
import type { ReportRow } from "./logic.ts";

const AGE_BAND_LABEL: Record<AgeBand, string> = {
  teen: "Teen",
  "young-adult": "Young adult",
  adult: "Adult",
  older: "Older",
};

const AGE_BAND_EMOJI: Record<AgeBand, string> = {
  teen: "🧒",
  "young-adult": "🧑",
  adult: "🧑‍💼",
  older: "🧓",
};

export function redditorsDemographicsBadge(
  report: ReportRow
): HTMLSpanElement | null {
  const demographics =
    investigationResults(report.investigation)?.demographics ?? null;

  if (!demographics || !demographics.age_band) {
    return null;
  }

  const badge = document.createElement("span");
  badge.className = "bon-demographics-badge";

  const emoji = document.createElement("span");
  emoji.className = "bon-demographics-badge__emoji";
  emoji.textContent = AGE_BAND_EMOJI[demographics.age_band];
  emoji.setAttribute("aria-hidden", "true");
  badge.appendChild(emoji);

  const label = document.createElement("span");
  label.textContent = AGE_BAND_LABEL[demographics.age_band];
  badge.appendChild(label);

  const lines = [
    `${AGE_BAND_LABEL[demographics.age_band]} — AI investigation pick:`,
  ];

  if (demographics.reasoning) {
    lines.push(`• ${demographics.reasoning}`);
  }

  if (demographics.confidence > 0) {
    lines.push(`• Confidence ${Math.round(demographics.confidence * 100)}%`);
  }

  badge.title = lines.join("\n");
  return badge;
}
