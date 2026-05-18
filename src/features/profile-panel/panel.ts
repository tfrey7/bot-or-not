// Composes the full Bot-or-Not profile panel: header (title + stat pill +
// investigate button), preview row (or bare toggle row when there's no
// investigation), and the collapsible body (investigation detail +
// reports section). Shared by both the profile-page panel and the
// post-author panel — the orchestrator decides where to anchor it.

import type { Report } from "../../types.ts";
import { bonNormalizeInvestigation } from "../../verdict.ts";
import { bonPanelBuildInvestigateBtn } from "./investigate_btn.ts";
import { bonPanelBuildInvestigationSection } from "./investigation_section.ts";
import { bonPanelBuildPreview } from "./preview.ts";
import { bonPanelBuildReportsSection } from "./reports_section.ts";
import { bonPanelAppendStatPills } from "./verdict_pill.ts";

export interface BuildPanelOpts {
  expanded?: boolean;
  id?: string;
}

export function bonPanelBuildProfilePanel(
  username: string,
  report: Report | null | undefined,
  { expanded = false, id = "bon-profile-panel" }: BuildPanelOpts = {}
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "bon-profile-panel";
  panel.dataset.username = username;

  const investigation = bonNormalizeInvestigation(report?.investigation);

  // Nested <button> is invalid HTML, and we want the re-investigate button
  // sitting inside the header — so the toggle target is a div with button
  // semantics rather than a real <button> element.
  const header = document.createElement("div");
  header.className = "bon-profile-panel__header";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", String(expanded));

  const title = document.createElement("span");
  title.className = "bon-profile-panel__title";
  title.textContent = "Bot or Not";
  header.appendChild(title);

  const stats = document.createElement("span");
  stats.className = "bon-profile-panel__stats";
  bonPanelAppendStatPills(stats, report);
  header.appendChild(stats);

  header.appendChild(bonPanelBuildInvestigateBtn(username, investigation));

  const preview = bonPanelBuildPreview(username, report);

  const body = document.createElement("div");
  body.className = "bon-profile-panel__body";
  body.classList.toggle("bon-profile-panel__body--expanded", expanded);
  const bodyInner = document.createElement("div");
  bodyInner.className = "bon-profile-panel__body-inner";
  bodyInner.appendChild(bonPanelBuildInvestigationSection(username, report));
  bodyInner.appendChild(bonPanelBuildReportsSection(report));
  body.appendChild(bodyInner);

  const toggleLink = document.createElement("button");
  toggleLink.type = "button";
  toggleLink.className = "bon-profile-panel__toggle";
  toggleLink.textContent = expanded ? "Show less" : "Show more";

  const toggle = (): void => {
    const isExpanded = header.getAttribute("aria-expanded") === "true";
    const next = !isExpanded;
    header.setAttribute("aria-expanded", String(next));
    body.classList.toggle("bon-profile-panel__body--expanded", next);
    toggleLink.textContent = next ? "Show less" : "Show more";
  };

  header.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    if (target?.closest("button, a")) {
      return;
    }
    toggle();
  });
  header.addEventListener("keydown", (e) => {
    if (e.target !== header) {
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  if (preview) {
    preview.addEventListener("click", (e) => {
      const target = e.target as Element | null;
      if (target?.closest("button, a")) {
        return;
      }
      toggle();
    });
  }
  toggleLink.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  panel.appendChild(header);
  if (preview) {
    preview.appendChild(toggleLink);
    panel.appendChild(preview);
  } else {
    const toggleRow = document.createElement("div");
    toggleRow.className = "bon-profile-panel__toggle-row";
    toggleRow.appendChild(toggleLink);
    panel.appendChild(toggleRow);
  }
  panel.appendChild(body);
  return panel;
}
