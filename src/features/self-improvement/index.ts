import type { Report } from "../../types.ts";
import { bonSelfImprovementCollect } from "./logic.ts";
import { bonSelfImprovementRow } from "./row.ts";

export function bonRenderSelfImprovement(
  reports: Record<string, Report>,
  container: HTMLElement | null
): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const annotated = bonSelfImprovementCollect(reports);

  const section = document.createElement("section");
  section.className = "bon-analytics bon-self-improvement";
  section.appendChild(buildHeader(annotated.length));

  if (annotated.length === 0) {
    section.appendChild(buildEmpty());
    container.appendChild(section);
    return;
  }

  const list = document.createElement("div");
  list.className = "bon-self-improvement-list";

  for (const item of annotated) {
    list.appendChild(bonSelfImprovementRow(item));
  }

  section.appendChild(list);
  container.appendChild(section);
}

function buildHeader(count: number): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-analytics-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Self-improvement";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-analytics-subtitle";
  sub.textContent =
    count === 0
      ? "Annotate any user from the Reports tab to populate this view."
      : `${count} annotated user${count === 1 ? "" : "s"} · your call vs the AI's`;
  header.appendChild(sub);

  return header;
}

function buildEmpty(): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "bon-analytics-empty";
  empty.textContent =
    "Nothing to show yet. Open a user in Reports, leave a rating or note in “Your notes,” and they'll appear here.";

  return empty;
}
