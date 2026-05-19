// "AI investigation" section in the expanded panel body — handles all four
// states (no investigation yet, running, error, done) and emits the
// detailed per-factor cards when there's a verdict to show.

import type { Report } from "../../types.ts";
import {
  bonIsInvestigationStale,
  bonNormalizeInvestigation,
} from "../../verdict.ts";
import { bonPanelBuildFactorsList } from "./factors_list.ts";

export function bonPanelBuildInvestigationSection(
  _username: string,
  report: Report | null | undefined
): HTMLDivElement {
  const investigation = bonNormalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );

  const section = document.createElement("div");
  section.className = "bon-panel-section";

  const title = document.createElement("p");
  title.className = "bon-panel-section__title";

  const label = document.createElement("span");
  label.textContent = "AI investigation";
  title.appendChild(label);

  section.appendChild(title);

  if (!investigation) {
    const empty = document.createElement("p");
    empty.className = "bon-panel-empty";

    empty.textContent =
      "Not yet investigated. Run the AI investigation for a verdict + factor breakdown.";

    section.appendChild(empty);
    return section;
  }

  if (investigation.status === "running") {
    const stale = bonIsInvestigationStale(investigation);

    const empty = document.createElement("p");
    empty.className = "bon-panel-empty";

    if (stale) {
      empty.textContent = investigation.startedAt
        ? `Stalled — started ${new Date(investigation.startedAt).toLocaleTimeString()}, never completed. Click investigate to retry.`
        : "Stalled — never completed. Click investigate to retry.";
    } else {
      empty.textContent = investigation.startedAt
        ? `Running since ${new Date(investigation.startedAt).toLocaleTimeString()}…`
        : "Running…";
    }

    section.appendChild(empty);
    return section;
  }

  if (investigation.status === "error") {
    const empty = document.createElement("p");
    empty.className = "bon-panel-empty";
    empty.textContent = `Investigation failed: ${investigation.error || "unknown error"}`;
    section.appendChild(empty);
    return section;
  }

  const metaParts: string[] = [];
  if (typeof investigation.confidence === "number") {
    metaParts.push(
      `overall confidence ${Math.round(investigation.confidence * 100)}%`
    );
  }
  if (investigation.runAt) {
    metaParts.push(`run ${new Date(investigation.runAt).toLocaleDateString()}`);
  }
  if (typeof investigation.postsFetched === "number") {
    metaParts.push(
      `${investigation.postsFetched} posts · ${investigation.commentsFetched ?? 0} comments`
    );
  }

  if (metaParts.length) {
    const meta = document.createElement("p");
    meta.className = "bon-panel-meta";
    meta.textContent = metaParts.join(" · ");
    section.appendChild(meta);
  }

  // Factor dots live in the always-visible preview — the body section keeps
  // the detailed per-factor cards only.
  if (Array.isArray(investigation.factors) && investigation.factors.length) {
    section.appendChild(bonPanelBuildFactorsList(investigation.factors));
  }

  return section;
}
