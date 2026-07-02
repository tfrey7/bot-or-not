// Compact subreddit list — left column of the Subreddits split. One
// selectable row per analyzed sub, sorted most-recent first. The full
// breakdown (sample mix, persona scatter) lives in the detail pane on
// the right; this list just gives the operator something scannable to
// click through.

import type {
  SubredditListEntry,
  SubredditVerdict,
} from "../subreddit-investigation";
import { describeListVerdict, nameKeyOf } from "./logic.ts";

interface SubredditsListProps {
  entries: SubredditListEntry[];
  selectedNameKey: string | null;
  onSelect: (nameKey: string) => void;
}

export function SubredditsList(props: SubredditsListProps) {
  const { entries, selectedNameKey, onSelect } = props;

  if (entries.length === 0) {
    return (
      <div class="bon-subreddits-list-empty">
        Open a subreddit on Reddit and use the Bot or Not strip below the banner
        to kick off an analysis.
      </div>
    );
  }

  return (
    <div class="bon-subreddits-list-wrap">
      <table class="bon-subreddits-list-table">
        <tbody>
          {entries.map((entry) => (
            <ListRow
              key={nameKeyOf(entry)}
              entry={entry}
              selected={selectedNameKey === nameKeyOf(entry)}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ListRowProps {
  entry: SubredditListEntry;
  selected: boolean;
  onSelect: (nameKey: string) => void;
}

function ListRow({ entry, selected, onSelect }: ListRowProps) {
  const { record, verdict } = entry;
  const nameKey = nameKeyOf(entry);
  const descriptor = describeListVerdict(verdict);

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(nameKey);
    }
  };

  return (
    <tr
      class={`bon-subreddits-list-row${selected ? " bon-subreddits-list-row--selected" : ""}`}
      data-subreddit={nameKey}
      role="button"
      tabIndex={0}
      aria-pressed={selected ? "true" : "false"}
      onClick={() => onSelect(nameKey)}
      onKeyDown={handleKeyDown}
    >
      <td class="bon-subreddits-list-name">r/{record.name}</td>
      {verdict.ready ? (
        <td class="bon-subreddits-list-verdict">
          <span
            class={`bon-verdict-badge bon-verdict-badge--${descriptor.badgeModifier}`}
          >
            {descriptor.label}
          </span>
        </td>
      ) : (
        <td class="bon-subreddits-list-verdict bon-subreddits-list-verdict--progress">
          <ListProgress verdict={verdict} />
        </td>
      )}
    </tr>
  );
}

function ListProgress({ verdict }: { verdict: SubredditVerdict }) {
  const settled = verdict.doneCount + verdict.errorCount;
  const total = verdict.total;
  const percent = total > 0 ? Math.round((settled / total) * 100) : 0;

  return (
    <div
      class="bon-subreddits-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={settled}
      aria-label={`Analyzing ${settled} of ${total} authors`}
    >
      <span class="bon-subreddits-progress-label">
        Analyzing · {settled}/{total}
      </span>
      <div class="bon-subreddits-progress-bar">
        <div
          class="bon-subreddits-progress-fill"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}
