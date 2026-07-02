// Background-sweeps card summarizing the daily blocklist cleanup: last
// sweep stats plus the most recently freed block-list slots.

import type { BlocklistCleanupState } from "../../storage";
import { formatDate } from "../../utils/format_time.ts";
import { analyticsChartCard } from "./chart_card.ts";
import { analyticsStatRows } from "./stat_rows.ts";

const RECENT_UNBLOCKS_SHOWN = 8;

export function analyticsSweepBlocklistCard(
  state: BlocklistCleanupState
): HTMLDivElement {
  const body = document.createElement("div");

  if (state.lastSweep === null) {
    const pending = document.createElement("p");
    pending.className = "bon-analytics-empty-small";
    pending.textContent =
      "First sweep hasn't run yet — it fires on the next background startup.";
    body.appendChild(pending);
  } else {
    body.appendChild(
      analyticsStatRows([
        ["Last sweep", formatDate(state.lastSweep.at)],
        ["Blocked accounts", `${state.lastSweep.blockedCount} of 1000`],
        ["Probed last sweep", String(state.lastSweep.probedCount)],
        ["Unblocked last sweep", String(state.lastSweep.unblockedCount)],
        ["Slots freed to date", String(state.unblocked.length)],
      ])
    );
  }

  if (state.unblocked.length > 0) {
    body.appendChild(buildRecentUnblocks(state.unblocked));
  }

  return analyticsChartCard(
    "Blocklist cleanup",
    "daily · unblocks dead accounts to free block-list slots",
    body
  );
}

function buildRecentUnblocks(
  unblocked: BlocklistCleanupState["unblocked"]
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "bon-sweep-list";

  for (const entry of unblocked.slice(-RECENT_UNBLOCKS_SHOWN).reverse()) {
    const item = document.createElement("li");

    const name = document.createElement("span");
    name.className = "bon-pii-name";
    name.textContent = entry.username;
    item.appendChild(name);

    const when = document.createElement("span");
    when.className = "bon-sweep-when";
    when.textContent = formatDate(entry.at);
    item.appendChild(when);

    list.appendChild(item);
  }

  return list;
}
