// Per-record inspector. The user picks a username from the dropdown and the
// pane below paints every field on that Report as a labeled section — the
// "human-friendly view of raw storage" that the diagnostics tab exists for.
//
// Selection is preserved across re-renders via the inspectorState argument so
// that storage.onChanged → render() doesn't yank the user out of whatever
// record they were looking at.

import type { Report } from "../../types.ts";
import { bonFmtUsd } from "../../utils/format_number.ts";
import {
  bonFmtDuration,
  bonFmtTimestamp,
  bonFormatDate,
} from "../../utils/format_time.ts";

export interface InspectorState {
  selectedUsername: string | null;
}

export function bonDiagnosticsRecordInspector(
  reports: Record<string, Report>,
  state: InspectorState
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-diag-section bon-diag-inspector";

  const heading = document.createElement("p");
  heading.className = "bon-diag-section-title";
  heading.textContent = "Inspect a record";
  wrap.appendChild(heading);

  const usernames = Object.keys(reports).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  if (usernames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-diag-empty";
    empty.textContent = "No records in storage.";
    wrap.appendChild(empty);
    return wrap;
  }

  if (
    state.selectedUsername === null ||
    !usernames.includes(state.selectedUsername)
  ) {
    state.selectedUsername = usernames[0];
  }

  const picker = document.createElement("select");
  picker.className = "bon-diag-picker";
  for (const name of usernames) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `u/${name}`;
    if (name === state.selectedUsername) {
      option.selected = true;
    }
    picker.appendChild(option);
  }
  wrap.appendChild(picker);

  const pane = document.createElement("div");
  pane.className = "bon-diag-inspector-pane";
  wrap.appendChild(pane);

  const paint = (): void => {
    pane.replaceChildren();
    const report = reports[state.selectedUsername!];
    if (report) {
      pane.appendChild(buildRecordView(state.selectedUsername!, report));
    }
  };

  picker.addEventListener("change", () => {
    state.selectedUsername = picker.value;
    paint();
  });

  paint();
  return wrap;
}

function buildRecordView(username: string, report: Report): DocumentFragment {
  const fragment = document.createDocumentFragment();

  fragment.appendChild(
    keyValueBlock("Account", [
      ["Username", username],
      ["Report count", String(report.count)],
      [
        "First seen",
        report.lastReportedAt ? bonFmtTimestamp(report.lastReportedAt) : "—",
      ],
      [
        "Last reported",
        report.lastReportedAt
          ? `${bonFmtTimestamp(report.lastReportedAt)} (${bonFormatDate(report.lastReportedAt)})`
          : "—",
      ],
      [
        "Account created (Reddit)",
        report.createdAt ? bonFmtTimestamp(report.createdAt * 1000) : "—",
      ],
      ["Ring ID", report.ringId ?? "—"],
    ])
  );

  fragment.appendChild(
    keyValueBlock("External status", [
      [
        "Reddit account",
        report.userStatus
          ? `${report.userStatus}${
              report.userStatusCheckedAt
                ? ` (checked ${bonFormatDate(report.userStatusCheckedAt)})`
                : ""
            }`
          : "—",
      ],
      [
        "BotBouncer",
        report.botBouncerStatus
          ? `${report.botBouncerStatus}${
              report.botBouncerCheckedAt
                ? ` (checked ${bonFormatDate(report.botBouncerCheckedAt)})`
                : ""
            }`
          : "—",
      ],
    ])
  );

  fragment.appendChild(buildInvestigationBlock(report));
  fragment.appendChild(buildFactorsBlock(report));
  fragment.appendChild(buildActivityBlock(report));
  fragment.appendChild(buildDossierBlock(report));
  fragment.appendChild(buildHistoryBlock(report));
  fragment.appendChild(buildRunsBlock(report));

  return fragment;
}

function buildInvestigationBlock(report: Report): HTMLElement {
  const investigation = report.investigation;
  if (!investigation) {
    return keyValueBlock("Investigation", [["Status", "never run"]]);
  }

  const rows: Array<[string, string]> = [["Status", investigation.status]];

  if (investigation.status === "running") {
    rows.push([
      "Started",
      investigation.startedAt ? bonFmtTimestamp(investigation.startedAt) : "—",
    ]);
  } else {
    rows.push([
      "Last ran",
      investigation.runAt ? bonFmtTimestamp(investigation.runAt) : "—",
    ]);
    rows.push(["Duration", bonFmtDuration(investigation.durationMs)]);
  }

  if (investigation.status === "error") {
    rows.push(["Error", investigation.error ?? "—"]);
  }

  if (investigation.status === "done") {
    rows.push(["Verdict", investigation.verdict ?? "—"]);
    rows.push([
      "Bot probability",
      investigation.botProbability != null
        ? `${(investigation.botProbability * 100).toFixed(1)}%`
        : "—",
    ]);
    rows.push([
      "Confidence",
      investigation.confidence != null
        ? `${(investigation.confidence * 100).toFixed(1)}%`
        : "—",
    ]);
    rows.push(["Model", investigation.model ?? "—"]);
    rows.push(["Cost", bonFmtUsd(investigation.costUsd)]);
    rows.push([
      "Tokens",
      investigation.usage ? formatUsageBrief(investigation.usage) : "—",
    ]);
    rows.push([
      "Posts / comments fetched",
      `${investigation.postsFetched} / ${investigation.commentsFetched}`,
    ]);
    rows.push([
      "Reddit fetch total",
      investigation.redditMetrics
        ? bonFmtDuration(investigation.redditMetrics.totalDurationMs)
        : "—",
    ]);
    if (investigation.persona) {
      rows.push(["Persona", investigation.persona.label]);
    }
  }

  const block = keyValueBlock("Investigation", rows);

  if (investigation.status === "done" && investigation.summary) {
    const note = document.createElement("p");
    note.className = "bon-diag-note";
    note.textContent = investigation.summary;
    block.appendChild(note);
  }

  if (investigation.status === "done" && investigation.persona?.reasoning) {
    const note = document.createElement("p");
    note.className = "bon-diag-note";
    note.textContent = `Persona reasoning: ${investigation.persona.reasoning}`;
    block.appendChild(note);
  }

  return block;
}

function formatUsageBrief(
  usage: NonNullable<Report["investigation"]>["usage"]
) {
  if (!usage) {
    return "—";
  }
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;
  return `${inputTokens} in · ${outputTokens} out · ${cached} cached`;
}

function buildFactorsBlock(report: Report): HTMLElement {
  const factors = report.investigation?.factors ?? [];
  const block = document.createElement("section");
  block.className = "bon-diag-block";

  const heading = document.createElement("p");
  heading.className = "bon-diag-block-title";
  heading.textContent = `Factors (${factors.length})`;
  block.appendChild(heading);

  if (factors.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-diag-empty";
    empty.textContent = "No factor scores recorded.";
    block.appendChild(empty);
    return block;
  }

  const table = document.createElement("table");
  table.className = "bon-diag-factor-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Factor", "Score", "Confidence", "Reasoning"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  for (const factor of factors) {
    const tr = document.createElement("tr");

    const keyCell = document.createElement("td");
    keyCell.className = "bon-diag-factor-key";
    keyCell.textContent = factor.key;
    tr.appendChild(keyCell);

    const scoreCell = document.createElement("td");
    scoreCell.className = "bon-diag-factor-num";
    scoreCell.textContent = formatSignedNum(factor.score);
    tr.appendChild(scoreCell);

    const confCell = document.createElement("td");
    confCell.className = "bon-diag-factor-num";
    confCell.textContent = factor.confidence.toFixed(2);
    tr.appendChild(confCell);

    const reasonCell = document.createElement("td");
    reasonCell.className = "bon-diag-factor-reason";
    reasonCell.textContent = factor.reasoning ?? "";
    tr.appendChild(reasonCell);

    body.appendChild(tr);
  }
  table.appendChild(body);

  block.appendChild(table);
  return block;
}

function buildActivityBlock(report: Report): HTMLElement {
  const activity = report.activityData;
  if (!activity) {
    return keyValueBlock("Activity heatmap", [["State", "not captured"]]);
  }

  return keyValueBlock("Activity heatmap", [
    ["Posts captured", String(activity.postTimestamps.length)],
    ["Comments captured", String(activity.commentTimestamps.length)],
    ["Subreddits seen", String(Object.keys(activity.subredditCounts).length)],
    [
      "Corpus size",
      activity.corpusChars > 0 ? `${activity.corpusChars} chars` : "—",
    ],
    [
      "Earliest post",
      activity.earliestPostAt
        ? bonFmtTimestamp(activity.earliestPostAt * 1000)
        : "—",
    ],
    [
      "Earliest comment",
      activity.earliestCommentAt
        ? bonFmtTimestamp(activity.earliestCommentAt * 1000)
        : "—",
    ],
    [
      "Fetched",
      activity.fetchedAt
        ? `${bonFmtTimestamp(activity.fetchedAt)} (limit ${activity.fetchLimit})`
        : "—",
    ],
    [
      "Truncated",
      [
        activity.postsLimited ? "posts" : null,
        activity.commentsLimited ? "comments" : null,
      ]
        .filter(Boolean)
        .join(", ") || "no",
    ],
  ]);
}

function buildDossierBlock(report: Report): HTMLElement {
  const items = report.contextItems;
  const block = document.createElement("section");
  block.className = "bon-diag-block";

  const heading = document.createElement("p");
  heading.className = "bon-diag-block-title";
  heading.textContent = `Dossier items (${items.length})`;
  block.appendChild(heading);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-diag-empty";
    empty.textContent = "No dossier items.";
    block.appendChild(empty);
    return block;
  }

  const list = document.createElement("ul");
  list.className = "bon-diag-list";

  for (const item of items) {
    const li = document.createElement("li");

    const meta = document.createElement("span");
    meta.className = "bon-diag-list-meta";
    const parts = [
      item.kind,
      item.provenance,
      item.subreddit ? `r/${item.subreddit}` : null,
      `added ${bonFormatDate(item.addedAt)}`,
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");
    li.appendChild(meta);

    const link = document.createElement("a");
    link.className = "bon-diag-list-link";
    link.href = item.permalink.startsWith("http")
      ? item.permalink
      : `https://www.reddit.com${item.permalink}`;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = item.title || item.body?.slice(0, 80) || item.permalink;
    li.appendChild(link);

    list.appendChild(li);
  }
  block.appendChild(list);

  return block;
}

function buildHistoryBlock(report: Report): HTMLElement {
  const history = report.history;
  const block = document.createElement("section");
  block.className = "bon-diag-block";

  const heading = document.createElement("p");
  heading.className = "bon-diag-block-title";
  heading.textContent = `Report history (${history.length})`;
  block.appendChild(heading);

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-diag-empty";
    empty.textContent = "No report history.";
    block.appendChild(empty);
    return block;
  }

  const list = document.createElement("ul");
  list.className = "bon-diag-list";

  for (const entry of [...history].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))) {
    const li = document.createElement("li");

    const meta = document.createElement("span");
    meta.className = "bon-diag-list-meta";
    const parts = [
      entry.at ? bonFmtTimestamp(entry.at) : null,
      entry.kind ?? null,
      entry.subreddit ? `r/${entry.subreddit}` : null,
      entry.status ? `status: ${entry.status}` : null,
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");
    li.appendChild(meta);

    if (entry.permalink) {
      const link = document.createElement("a");
      link.className = "bon-diag-list-link";
      link.href = `https://www.reddit.com${entry.permalink}`;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = entry.postTitle || entry.permalink;
      li.appendChild(link);
    } else if (entry.postTitle) {
      const title = document.createElement("span");
      title.className = "bon-diag-list-link";
      title.textContent = entry.postTitle;
      li.appendChild(title);
    }

    list.appendChild(li);
  }
  block.appendChild(list);
  return block;
}

function buildRunsBlock(report: Report): HTMLElement {
  const runs = report.investigation?.runs ?? [];
  const block = document.createElement("section");
  block.className = "bon-diag-block";

  const heading = document.createElement("p");
  heading.className = "bon-diag-block-title";
  heading.textContent = `Run log (${runs.length})`;
  block.appendChild(heading);

  if (runs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-diag-empty";
    empty.textContent = "No completed runs recorded.";
    block.appendChild(empty);
    return block;
  }

  const table = document.createElement("table");
  table.className = "bon-diag-run-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["When", "Status", "Verdict", "Duration", "Cost"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  for (const run of [...runs].sort((a, b) => b.runAt - a.runAt)) {
    const tr = document.createElement("tr");

    const whenCell = document.createElement("td");
    whenCell.textContent = run.runAt ? bonFmtTimestamp(run.runAt) : "—";
    tr.appendChild(whenCell);

    const statusCell = document.createElement("td");
    statusCell.textContent = run.status;
    tr.appendChild(statusCell);

    const verdictCell = document.createElement("td");
    verdictCell.textContent = run.verdict ?? "—";
    tr.appendChild(verdictCell);

    const durationCell = document.createElement("td");
    durationCell.textContent = bonFmtDuration(run.durationMs);
    tr.appendChild(durationCell);

    const costCell = document.createElement("td");
    costCell.textContent = bonFmtUsd(run.costUsd);
    tr.appendChild(costCell);

    body.appendChild(tr);
  }
  table.appendChild(body);
  block.appendChild(table);
  return block;
}

function keyValueBlock(
  title: string,
  rows: Array<[string, string]>
): HTMLElement {
  const block = document.createElement("section");
  block.className = "bon-diag-block";

  const heading = document.createElement("p");
  heading.className = "bon-diag-block-title";
  heading.textContent = title;
  block.appendChild(heading);

  const table = document.createElement("table");
  table.className = "bon-diag-kv";

  for (const [label, value] of rows) {
    const tr = document.createElement("tr");

    const labelCell = document.createElement("td");
    labelCell.className = "bon-diag-kv-label";
    labelCell.textContent = label;
    tr.appendChild(labelCell);

    const valueCell = document.createElement("td");
    valueCell.className = "bon-diag-kv-value";
    valueCell.colSpan = 2;
    valueCell.textContent = value;
    tr.appendChild(valueCell);

    table.appendChild(tr);
  }

  block.appendChild(table);
  return block;
}

function formatSignedNum(value: number): string {
  if (value > 0) {
    return `+${value.toFixed(2)}`;
  }
  return value.toFixed(2);
}
