// Render the Subreddits tab body as a table — one row per analyzed sub,
// sorted most-recent first. Columns:
//   1. Subreddit name (links out to reddit.com/r/<name>)
//   2. Verdict badge (Compromised / Healthy / Inconclusive / Pending)
//   3. Analyzed-at relative timestamp
//   4. Sample mix — proportional stacked bar across the verdict classes
//      + a compact count line ("2 bot · 5 human · 2 errored")
//
// Live updates: the reports orchestrator re-renders this widget when
// `subreddits-changed` or `reports-changed` fires, so verdicts and the
// breakdown bar repaint as individual investigations complete.

import { bonFormatDate } from "../../utils/format_time.ts";
import type { Verdict } from "../../types.ts";
import type { BonSubredditListEntry } from "../subreddit-investigation/handlers.ts";
import type {
  BonSubredditSample,
  BonSubredditVerdict,
} from "../subreddit-investigation/verdict.ts";

// Each verdict bucket reuses the existing .bon-verdict-badge stamp style
// from cell_verdict.css so the Subreddits tab reads consistent with the
// per-user verdict stamps on the Reports tab.
type SegmentKey =
  | "bot"
  | "likely-bot"
  | "uncertain"
  | "likely-human"
  | "human"
  | "error"
  | "pending";

interface SegmentDescriptor {
  label: string;
  badgeModifier: string;
}

interface VerdictDescriptor {
  badgeModifier: string;
  label: string;
  hint: string;
}

const BON_SEGMENT_ORDER: SegmentKey[] = [
  "bot",
  "likely-bot",
  "uncertain",
  "likely-human",
  "human",
  "error",
  "pending",
];

const BON_SEGMENT_INFO: Record<SegmentKey, SegmentDescriptor> = {
  bot: { label: "bot", badgeModifier: "bot" },
  "likely-bot": { label: "likely bot", badgeModifier: "likely-bot" },
  uncertain: { label: "uncertain", badgeModifier: "uncertain" },
  "likely-human": { label: "likely human", badgeModifier: "likely-human" },
  human: { label: "human", badgeModifier: "human" },
  error: { label: "errored", badgeModifier: "error" },
  pending: { label: "pending", badgeModifier: "queued" },
};

export function bonRenderSubredditsList(
  entries: BonSubredditListEntry[]
): HTMLElement {
  const section = document.createElement("section");
  section.className = "bon-subreddits";
  section.appendChild(buildHeader(entries));

  if (entries.length === 0) {
    section.appendChild(buildEmptyState());
    return section;
  }

  section.appendChild(buildTable(entries));
  return section;
}

function buildHeader(entries: BonSubredditListEntry[]): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-subreddits-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Subreddits";
  header.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "bon-subreddits-subtitle";
  sub.textContent =
    entries.length === 0
      ? "No subreddits analyzed yet. Open a subreddit on Reddit and use the Bot or Not strip below the banner to kick off an analysis."
      : `${entries.length} subreddit${entries.length === 1 ? "" : "s"} analyzed — verdicts derive live from the per-sample investigations.`;
  header.appendChild(sub);

  return header;
}

function buildEmptyState(): HTMLElement {
  const div = document.createElement("div");
  div.className = "bon-subreddits-empty";
  div.textContent =
    "Nothing here yet. The Subreddits tab fills in as you kick off subreddit-level analyses from Reddit.";

  return div;
}

function buildTable(entries: BonSubredditListEntry[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-subreddits-table-wrap";

  const table = document.createElement("table");
  table.className = "bon-subreddits-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const label of ["Subreddit", "Verdict", "Analyzed", "Sample mix"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const entry of entries) {
    tbody.appendChild(buildRow(entry));
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildRow(entry: BonSubredditListEntry): HTMLElement {
  const { record, verdict } = entry;
  const descriptor = describeVerdict(verdict);
  const row = document.createElement("tr");

  row.appendChild(buildNameCell(record.name));
  row.appendChild(buildVerdictCell(descriptor));
  row.appendChild(buildAnalyzedCell(record.analyzedAt));
  row.appendChild(buildMixCell(verdict));

  return row;
}

function buildNameCell(name: string): HTMLElement {
  const td = document.createElement("td");
  td.className = "bon-subreddits-cell-name";

  const link = document.createElement("a");
  link.href = `https://www.reddit.com/r/${encodeURIComponent(name)}/`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `r/${name}`;
  td.appendChild(link);

  return td;
}

function buildVerdictCell(descriptor: VerdictDescriptor): HTMLElement {
  const td = document.createElement("td");
  td.className = "bon-subreddits-cell-verdict";

  const badge = document.createElement("span");
  badge.className = `bon-verdict-badge bon-verdict-badge--${descriptor.badgeModifier}`;
  badge.textContent = descriptor.label;
  badge.title = descriptor.hint;
  td.appendChild(badge);

  return td;
}

function buildAnalyzedCell(analyzedAt: number): HTMLElement {
  const td = document.createElement("td");
  td.className = "bon-subreddits-cell-analyzed";
  td.textContent = analyzedAt > 0 ? bonFormatDate(analyzedAt) : "—";
  return td;
}

function buildMixCell(verdict: BonSubredditVerdict): HTMLElement {
  const td = document.createElement("td");
  td.className = "bon-subreddits-cell-mix";

  const counts = countSegments(verdict.samples);

  const row = document.createElement("div");
  row.className = "bon-subreddits-mix";

  for (const key of BON_SEGMENT_ORDER) {
    const count = counts[key];
    if (count === 0) {
      continue;
    }

    const info = BON_SEGMENT_INFO[key];
    const badge = document.createElement("span");
    badge.className = `bon-verdict-badge bon-verdict-badge--${info.badgeModifier}`;
    badge.textContent = `${count} ${info.label}`;
    row.appendChild(badge);
  }

  if (row.childElementCount === 0) {
    const empty = document.createElement("span");
    empty.className = "bon-subreddits-mix-empty";
    empty.textContent = "—";
    row.appendChild(empty);
  }

  td.appendChild(row);
  return td;
}

function countSegments(
  samples: BonSubredditSample[]
): Record<SegmentKey, number> {
  const counts: Record<SegmentKey, number> = {
    bot: 0,
    "likely-bot": 0,
    uncertain: 0,
    "likely-human": 0,
    human: 0,
    error: 0,
    pending: 0,
  };

  for (const sample of samples) {
    if (sample.status === "done" && sample.verdict) {
      counts[verdictBucket(sample.verdict)] += 1;
      continue;
    }

    if (sample.status === "error") {
      counts.error += 1;
      continue;
    }

    counts.pending += 1;
  }

  return counts;
}

function verdictBucket(verdict: Verdict): SegmentKey {
  if (verdict === "bot") {
    return "bot";
  }

  if (verdict === "likely-bot") {
    return "likely-bot";
  }

  if (verdict === "likely-human") {
    return "likely-human";
  }

  if (verdict === "human") {
    return "human";
  }

  return "uncertain";
}

function describeVerdict(verdict: BonSubredditVerdict): VerdictDescriptor {
  if (!verdict.ready) {
    return {
      badgeModifier: "queued",
      label: "Pending",
      hint: `${verdict.doneCount} of ${verdict.total} samples completed so far.`,
    };
  }

  if (verdict.inconclusive) {
    return {
      badgeModifier: "uncertain",
      label: "Inconclusive",
      hint: "No sampled author has a usable verdict — every investigation errored or never landed.",
    };
  }

  if (verdict.compromised) {
    return {
      badgeModifier: "bot",
      label: "Compromised",
      hint: `${verdict.botLeaningCount} of ${verdict.doneCount} sampled authors are bot-leaning (≥50%).`,
    };
  }

  return {
    badgeModifier: "human",
    label: "Healthy",
    hint: `${verdict.botLeaningCount} of ${verdict.doneCount} sampled authors are bot-leaning (under the 50% threshold).`,
  };
}
