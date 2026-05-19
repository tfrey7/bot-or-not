// Operator-collected context dossier sub-section shown when a report row is
// expanded. Lists every ContextItem with provenance + a remove button, and
// nudges the operator that re-running the investigation will incorporate them.

import type { ContextItem } from "../../types.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import { bonLinkifyReddit } from "../../utils/linkify_reddit.ts";

function resolveUrl(permalink: string): string {
  if (permalink.startsWith("http")) {
    return permalink;
  }
  const prefix = permalink.startsWith("/") ? "" : "/";
  return `https://www.reddit.com${prefix}${permalink}`;
}

function renderItem(item: ContextItem, username: string): HTMLLIElement {
  const listItem = document.createElement("li");
  listItem.className = "bon-dossier-item";

  const header = document.createElement("div");
  header.className = "bon-dossier-item__header";

  const kindIcon = document.createElement("span");
  kindIcon.className = "bon-dossier-item__kind";
  kindIcon.textContent = item.kind === "post" ? "📝" : "💬";
  kindIcon.title = item.kind === "post" ? "Post" : "Comment";
  header.appendChild(kindIcon);

  const sub = document.createElement("span");
  sub.className = "bon-dossier-item__sub";
  sub.textContent = item.subreddit ?? "—";
  header.appendChild(sub);

  if (item.score != null) {
    const score = document.createElement("span");
    score.className = "bon-dossier-item__score";
    score.textContent = `${item.score} pts`;
    header.appendChild(score);
  }

  if (item.createdAt) {
    const created = document.createElement("span");
    created.className = "bon-dossier-item__date";
    const createdAt = new Date(item.createdAt).getTime();
    created.textContent = bonFormatDate(createdAt);
    created.title = new Date(item.createdAt).toLocaleString();
    header.appendChild(created);
  }

  const provenance = document.createElement("span");
  provenance.className = `bon-dossier-item__prov bon-dossier-item__prov--${item.provenance}`;
  provenance.textContent =
    item.provenance === "auto" ? "auto-captured" : "operator-added";
  provenance.title =
    item.provenance === "auto"
      ? `Captured ${bonFormatDate(item.addedAt)} when the report was filed`
      : `Added ${bonFormatDate(item.addedAt)} via the in-page button`;
  header.appendChild(provenance);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "bon-dossier-item__remove";
  removeButton.textContent = "Remove";
  removeButton.title = "Remove from dossier";
  removeButton.addEventListener("click", async () => {
    removeButton.disabled = true;
    await browser.runtime.sendMessage({
      type: "dossier-remove",
      username,
      permalink: item.permalink,
    });
    // storage.onChanged in the reports orchestrator will re-render the list.
  });
  header.appendChild(removeButton);

  listItem.appendChild(header);

  if (item.title) {
    const title = document.createElement("p");
    title.className = "bon-dossier-item__title";
    title.appendChild(bonLinkifyReddit(item.title));
    listItem.appendChild(title);
  }

  if (item.body) {
    const body = document.createElement("p");
    body.className = "bon-dossier-item__body";
    body.appendChild(bonLinkifyReddit(item.body));
    listItem.appendChild(body);
  }

  const link = document.createElement("a");
  link.href = resolveUrl(item.permalink);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "bon-dossier-item__permalink";
  link.textContent = item.permalink;
  listItem.appendChild(link);

  return listItem;
}

export function bonReportsDossierSection(
  username: string,
  items: ContextItem[]
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = `Dossier (${items.length})`;
  wrap.appendChild(title);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-dossier-empty";
    empty.textContent =
      "No operator-collected context yet. Use the “Add context” button next to a post or comment on Reddit to enrich this dossier; re-run the investigation to incorporate it.";
    wrap.appendChild(empty);
    return wrap;
  }

  const hint = document.createElement("p");
  hint.className = "bon-dossier-hint";
  hint.textContent =
    "Re-run the investigation (🔁 in the actions column) to incorporate these into Claude's analysis.";
  wrap.appendChild(hint);

  const list = document.createElement("ul");
  list.className = "bon-dossier-list";
  for (const item of items.slice().sort((a, b) => b.addedAt - a.addedAt)) {
    list.appendChild(renderItem(item, username));
  }
  wrap.appendChild(list);

  return wrap;
}
