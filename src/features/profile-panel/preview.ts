// The always-visible preview block between the panel header and the
// collapsible body: investigation summary + top-reasons list + factor-dots
// strip on the left, persona radar card on the right. Returns null when
// there's no investigation to preview so the panel can fall back to a
// single bare toggle row.

import { bonNormalizeInvestigation, bonTopReasons } from "../../verdict.ts";
import { BON_FACTOR_LABELS } from "../../factors.ts";
import type { Factor, Report } from "../../types.ts";
import { bonScoreLeaning } from "../../utils/scoring.ts";
import { bonPanelBuildFactorDots } from "./factor_dots.ts";
import { bonPanelBuildPersonaStrip } from "./persona_radar.ts";

function buildTopReasonsList(factors: Factor[]): HTMLUListElement | null {
  const topReasons = bonTopReasons(factors, 3);

  if (!topReasons.length) {
    return null;
  }

  const ul = document.createElement("ul");
  ul.className = "bon-profile-panel__reasons";

  for (const factor of topReasons) {
    const li = document.createElement("li");
    const leaning = bonScoreLeaning(factor.score, factor.confidence);

    li.className = `bon-reason bon-reason--${leaning}`;

    const bullet = document.createElement("span");
    bullet.className = "bon-reason__bullet";
    bullet.setAttribute("aria-hidden", "true");
    li.appendChild(bullet);

    const text = document.createElement("span");
    text.className = "bon-reason__text";

    const label = document.createElement("strong");
    label.textContent =
      BON_FACTOR_LABELS[factor.key] ??
      (factor as { name?: string }).name ??
      factor.key;

    text.appendChild(label);

    if (factor.reasoning) {
      text.appendChild(document.createTextNode(` — ${factor.reasoning}`));
    }

    li.appendChild(text);
    ul.appendChild(li);
  }

  return ul;
}

export function bonPanelBuildPreview(
  _username: string,
  report: Report | null | undefined
): HTMLDivElement | null {
  const investigation = bonNormalizeInvestigation(report?.investigation);
  const hasFactors = (investigation?.factors.length ?? 0) > 0;

  if (!investigation?.summary && !hasFactors) {
    return null;
  }

  const preview = document.createElement("div");
  preview.className = "bon-profile-panel__preview";

  const summaryCol = document.createElement("div");
  summaryCol.className = "bon-profile-panel__preview-summary";

  if (investigation?.summary) {
    const summary = document.createElement("p");
    summary.className = "bon-profile-panel__summary";
    summary.textContent = investigation.summary;
    summaryCol.appendChild(summary);
  }

  if (investigation && hasFactors) {
    const reasons = buildTopReasonsList(investigation.factors);
    if (reasons) {
      summaryCol.appendChild(reasons);
    }
  }

  // Factor dot strip lives in the always-visible preview so the at-a-glance
  // signal map is readable without expanding the panel. Each dot carries a
  // hover-card popover with the full factor reasoning + evidence. Tucked
  // under the summary in the left column so it fills the vertical space
  // the persona card claims on the right.
  if (investigation?.status === "done") {
    const dotsGroup = document.createElement("div");
    dotsGroup.className = "bon-panel-factor-signals";

    const dotsLabel = document.createElement("p");
    dotsLabel.className = "bon-panel-factor-signals__label";
    dotsLabel.textContent = "Factor signals — hover for details";
    dotsGroup.appendChild(dotsLabel);

    dotsGroup.appendChild(bonPanelBuildFactorDots(investigation));
    summaryCol.appendChild(dotsGroup);
  }

  const personaBlock = investigation?.persona?.label
    ? bonPanelBuildPersonaStrip(investigation.persona)
    : null;

  if (personaBlock && summaryCol.childNodes.length) {
    const row = document.createElement("div");
    row.className = "bon-profile-panel__preview-row";
    row.appendChild(summaryCol);
    row.appendChild(personaBlock);
    preview.appendChild(row);
  } else {
    if (summaryCol.childNodes.length) {
      preview.appendChild(summaryCol);
    }
    if (personaBlock) {
      preview.appendChild(personaBlock);
    }
  }

  return preview;
}
