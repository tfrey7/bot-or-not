// One row of the reports list — the compact summary row of the
// master-detail view. Clicking the row selects the user; the tab renders
// the user's full detail into the side pane. The tombstone, ring chip,
// and verdict badge are vanilla builders shared with other surfaces, so
// they mount through the Vanilla host.

import { buildRingChip } from "../../utils/ring_chip.ts";
import { Vanilla } from "../../utils/vanilla.tsx";
import { redditorsVerdictBadge } from "./cell_verdict.ts";
import { buildTombstone } from "./tombstone.ts";
import type { ReportRow } from "./logic.ts";

export interface RedditorsRowProps {
  report: ReportRow;
  selected: boolean;
  queueAhead: number;
  onSelect: (username: string) => void;
}

export function RedditorsRow({
  report,
  selected,
  queueAhead,
  onSelect,
}: RedditorsRowProps) {
  const { username, investigation, ringId, userStatus } = report;

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(username);
    }
  };

  // Plain click stays in-page via onSelect; the href exists so
  // Cmd/Ctrl-click and right-click "Open in new tab" still work.
  const handleLinkClick = (event: MouseEvent): void => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect(username);
  };

  return (
    <tr
      class={
        selected
          ? "bon-row-summary bon-row-summary--selected"
          : "bon-row-summary"
      }
      data-bon-username={username}
      tabIndex={0}
      role="button"
      aria-pressed={selected ? "true" : "false"}
      onClick={() => onSelect(username)}
      onKeyDown={handleKeyDown}
    >
      <td>
        <span class="bon-username-cell">
          <span class="bon-username-cell-row">
            <a
              href={`?user=${encodeURIComponent(username)}`}
              class="bon-pii-name"
              onClick={handleLinkClick}
            >
              u/{username}
            </a>
            <Vanilla node={buildTombstone(userStatus)} />
            <Vanilla node={buildRingChip(ringId ?? null)} />
          </span>
        </span>
      </td>
      <td class="bon-tags-cell">
        <div class="bon-tags-row">
          <Vanilla
            node={redditorsVerdictBadge(investigation, !!ringId, queueAhead)}
          />
        </div>
      </td>
    </tr>
  );
}
