// Composes the Bot-or-Not profile panel rendered inside the inline-tag
// flyout: header (title + stat pills + investigate button) and preview row
// (summary + top-reasons + persona radar). Deeper drill-downs (full
// investigation history, all reports) live on the dedicated reports page,
// reachable via the reports-link in the header.

import type { Report } from "../../types.ts";
import { bonRingChip } from "../../utils/ring_chip.ts";
import { bonNormalizeInvestigation } from "../../verdict.ts";
import { bonPanelBuildInvestigateBtn } from "./investigate_btn.ts";
import { bonPanelBuildPreview } from "./preview.ts";
import { bonPanelBuildReportsLink } from "./reports_link.ts";

export interface BuildPanelOpts {
  id?: string;
  expectedDurationMs?: number | null;
}

export function bonPanelBuildProfilePanel(
  username: string,
  report: Report | null | undefined,
  { id = "bon-profile-panel", expectedDurationMs = null }: BuildPanelOpts = {}
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "bon-profile-panel";
  panel.dataset.username = username;

  const investigation = bonNormalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );

  const header = document.createElement("div");
  header.className = "bon-profile-panel__header";

  const title = document.createElement("span");
  title.className = "bon-profile-panel__title";
  title.textContent = "Bot or Not";
  header.appendChild(title);

  const ringChip = bonRingChip(report?.ringId ?? null);
  if (ringChip) {
    header.appendChild(ringChip);
  }

  header.appendChild(bonPanelBuildReportsLink(username));
  header.appendChild(bonPanelBuildInvestigateBtn(username, investigation));

  const preview = bonPanelBuildPreview(username, report, {
    expectedDurationMs,
  });

  panel.appendChild(header);

  if (preview) {
    panel.appendChild(preview);
  }

  return panel;
}
