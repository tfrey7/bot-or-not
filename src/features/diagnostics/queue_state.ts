// Live snapshot of the investigation queue: which usernames are currently
// running against the concurrency cap, and which are queued behind them.
// Renders near the top of the diagnostics page so a stuck or backlogged
// queue is the first thing visible.

import { BON_INVESTIGATION_CONCURRENCY } from "../investigation/handlers.ts";
import { bonFmtDuration } from "../../utils/format_time.ts";
import type { DiagnosticsSummary, QueueEntry } from "./logic.ts";

export function bonDiagnosticsQueueState(
  summary: DiagnosticsSummary
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "bon-diag-section bon-diag-queue";

  const heading = document.createElement("p");
  heading.className = "bon-diag-section-title";
  heading.textContent = "Investigation queue";
  card.appendChild(heading);

  card.appendChild(buildSlotBar(summary.queueRunning.length));

  const running = buildList(
    "Running",
    summary.queueRunning,
    "elapsed",
    "All slots idle."
  );
  card.appendChild(running);

  const queued = buildList(
    `Queued (${summary.queueQueued.length})`,
    summary.queueQueued,
    "waiting",
    "Nothing waiting."
  );
  card.appendChild(queued);

  return card;
}

function buildSlotBar(activeCount: number): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-diag-queue-slots";

  for (let i = 0; i < BON_INVESTIGATION_CONCURRENCY; i += 1) {
    const slot = document.createElement("span");
    slot.className = "bon-diag-queue-slot";
    if (i < activeCount) {
      slot.classList.add("bon-diag-queue-slot-active");
    }

    wrap.appendChild(slot);
  }

  const label = document.createElement("span");
  label.className = "bon-diag-queue-slot-label";
  label.textContent = `${activeCount} / ${BON_INVESTIGATION_CONCURRENCY} running`;
  wrap.appendChild(label);

  return wrap;
}

function buildList(
  title: string,
  entries: QueueEntry[],
  durationLabel: string,
  emptyText: string
): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "bon-diag-queue-list";

  const head = document.createElement("p");
  head.className = "bon-diag-queue-list-title";
  head.textContent = title;
  block.appendChild(head);

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-diag-empty";
    empty.textContent = emptyText;
    block.appendChild(empty);
    return block;
  }

  const now = Date.now();
  const ul = document.createElement("ul");
  ul.className = "bon-diag-queue-items";

  for (const entry of entries) {
    const li = document.createElement("li");

    const user = document.createElement("span");
    user.className = "bon-diag-queue-user";
    user.textContent = `u/${entry.username}`;
    li.appendChild(user);

    const meta = document.createElement("span");
    meta.className = "bon-diag-queue-meta";
    meta.textContent =
      entry.since == null
        ? `${durationLabel} —`
        : `${durationLabel} ${bonFmtDuration(now - entry.since)}`;
    li.appendChild(meta);

    ul.appendChild(li);
  }

  block.appendChild(ul);
  return block;
}
