// Composes the Bot-or-Not profile panel rendered inside the inline-tag
// flyout: header (title + stat pills + investigate button) and preview row
// (summary + top-reasons + persona radar). Deeper drill-downs (full
// investigation history, all reports) live on the dedicated reports page,
// reachable via the reports-link in the header.

import type { Report } from "../../types.ts";
import { buildRingChip } from "../../utils/ring_chip.ts";
import { normalizeInvestigation } from "../../verdict.ts";
import { panelBuildInvestigateBtn } from "./investigate_btn.ts";
import { panelBuildNotesStrip } from "./notes_strip.ts";
import { panelBuildPreview } from "./preview.ts";
import { panelBuildReportsLink } from "./reports_link.ts";

export interface BuildPanelOpts {
  id?: string;
  expectedDurationMs?: number | null;
}

export function panelBuildProfilePanel(
  username: string,
  report: Report | null | undefined,
  { id = "bon-profile-panel", expectedDurationMs = null }: BuildPanelOpts = {}
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "bon-profile-panel";
  panel.dataset.username = username;

  const investigation = normalizeInvestigation(
    report?.investigation,
    !!report?.ringId
  );

  const header = document.createElement("div");
  header.className = "bon-profile-panel__header";

  const title = document.createElement("span");
  title.className = "bon-profile-panel__title";
  title.textContent = "Bot or Not";
  header.appendChild(title);

  const ringChip = buildRingChip(report?.ringId ?? null);
  if (ringChip) {
    header.appendChild(ringChip);
  }

  header.appendChild(panelBuildReportsLink(username));
  header.appendChild(panelBuildInvestigateBtn(username, investigation));

  const preview = panelBuildPreview(username, report, {
    expectedDurationMs,
  });

  panel.appendChild(header);

  if (preview) {
    panel.appendChild(preview);
  }

  const notes = panelBuildNotesStrip(report?.userNotes);
  if (notes) {
    panel.appendChild(notes);
  }

  return panel;
}
