// AI command bar — the Enter-to-run search input and the agent-filter banner.
// On submit, opens the chat-style command modal with the initial prompt; the
// modal owns the per-turn loop, port lifecycle, and follow-up input from
// there. This file's job is the page-level input, the persistent
// agent-filter banner under the tabs, and the / and Esc keyboard hooks.

import { type AiCommandAction, type AiCommandResult } from "../ai-command";
import { bonPageOpenCommandModal } from "./command_modal.ts";
import type { ReportRow } from "../redditors";

export interface BonPageCommandBarDeps {
  searchInput: HTMLInputElement;
  agentFilterEl: HTMLElement;
  agentFilterLabelEl: HTMLElement;
  agentFilterClearBtn: HTMLButtonElement;
  getReports(): ReportRow[];
  onAgentFilterChange(): void;
  onNavigateToUser(username: string): void;
  onCommandReload(): Promise<void>;
}

export interface BonPageCommandBarHandle {
  getAgentFilter(): ReadonlySet<string> | null;
  renderAgentFilterBanner(): void;
}

// Rotating placeholder examples — advertise the agent's range without
// crowding the bar with help text. Cycled every ~5s when the input is empty
// and unfocused; pauses on focus so the operator isn't reading a moving
// target while they type.
const BON_CMD_PLACEHOLDERS = [
  "Try: investigate u/alice",
  "Try: filter to doomer accounts",
  "Try: link alice + bob into a ring",
  "Try: what's special about jane?",
  "Try: open the most recent dossier",
];

const BON_CMD_PLACEHOLDER_INTERVAL_MS = 5000;

export function bonPageInitCommandBar(
  deps: BonPageCommandBarDeps
): BonPageCommandBarHandle {
  const {
    searchInput,
    agentFilterEl,
    agentFilterLabelEl,
    agentFilterClearBtn,
  } = deps;

  let agentFilter: Set<string> | null = null;
  let agentFilterLabel = "";
  let commandInflight = false;

  installPlaceholderRotation(searchInput);

  // The bar wrapper is the FLIP source — the modal grows out of it and
  // shrinks back into it. The status element below it is filled with the
  // agent's final summary when an action turn auto-minimizes.
  const commandBarEl = searchInput.closest(
    ".bon-command-bar"
  ) as HTMLElement | null;
  const statusEl = document.getElementById(
    "bon-command-status"
  ) as HTMLElement | null;

  const showStatusHtml = (html: string): void => {
    if (!statusEl) {
      return;
    }

    // Re-trigger the entry animation each time so successive updates feel
    // like fresh notes rather than silent edits.
    statusEl.style.animation = "none";
    statusEl.innerHTML = html;
    statusEl.hidden = false;
    void statusEl.offsetWidth;
    statusEl.style.animation = "";
  };

  const clearStatus = (): void => {
    if (!statusEl) {
      return;
    }

    statusEl.hidden = true;
    statusEl.innerHTML = "";
  };

  const renderAgentFilterBanner = (): void => {
    if (!agentFilter) {
      agentFilterEl.hidden = true;
      agentFilterLabelEl.textContent = "";
      return;
    }

    const total = deps.getReports().length;
    const countText = `${agentFilter.size} of ${total} users`;
    agentFilterEl.hidden = false;
    agentFilterLabelEl.textContent = agentFilterLabel
      ? `AI filter · ${agentFilterLabel} · ${countText}`
      : `AI filter · showing ${countText}`;
  };

  const clearAgentFilter = (): void => {
    if (!agentFilter) {
      return;
    }

    agentFilter = null;
    agentFilterLabel = "";
    renderAgentFilterBanner();
    deps.onAgentFilterChange();
  };

  // Some agent tools (navigate_to_user, filter_users) are UI-side effects
  // rather than storage mutations — the background returns ok with hints, and
  // we apply them here once the data reload settles. Iterate in order so a
  // multi-step command can end on a specific selection or filter.
  const applyClientActions = (actions: AiCommandAction[]): void => {
    for (const action of actions) {
      if (!action.ok) {
        continue;
      }

      if (action.tool === "navigate_to_user") {
        const resolved =
          (action.result as { username?: string } | undefined)?.username ??
          (action.input as { username?: string }).username;

        if (!resolved) {
          continue;
        }

        const match = deps
          .getReports()
          .find(
            (report) => report.username.toLowerCase() === resolved.toLowerCase()
          );

        if (!match) {
          continue;
        }

        deps.onNavigateToUser(match.username);
      }

      if (action.tool === "filter_users") {
        const input = action.input as {
          usernames?: unknown;
          label?: unknown;
        };

        const usernames = input.usernames;
        const list = Array.isArray(usernames) ? (usernames as string[]) : [];
        if (list.length === 0) {
          clearAgentFilter();
        } else {
          // Resolve to canonical stored keys (case-insensitive) so the filter
          // works even if Claude shifted casing.
          const resolved = new Set<string>();
          const reports = deps.getReports();

          for (const name of list) {
            const match = reports.find(
              (report) => report.username.toLowerCase() === name.toLowerCase()
            );

            if (match) {
              resolved.add(match.username);
            }
          }

          agentFilter = resolved;
          agentFilterLabel =
            typeof input.label === "string" ? input.label.trim() : "";

          renderAgentFilterBanner();
          deps.onAgentFilterChange();
        }
      }
    }
  };

  const openModal = (initialPrompt: string): void => {
    if (commandInflight) {
      return;
    }

    commandInflight = true;
    searchInput.value = "";

    // Clear any leftover status from a previous auto-minimize so the bar
    // area resets while the new modal grows.
    clearStatus();

    bonPageOpenCommandModal(initialPrompt, {
      sourceEl: commandBarEl,

      // Fires once per agent turn that settles. Reload the table, then apply
      // any UI-side actions the agent emitted. Errors and aborts still flow
      // through this path so a partial result (e.g. tools ran, then aborted)
      // still lands in the UI.
      onTurnSettled: async (result: AiCommandResult) => {
        await deps.onCommandReload();
        applyClientActions(result.actions);
      },

      // Fires when an action turn auto-minimizes — render the agent's final
      // summary as a status line below the bar so the operator still sees
      // what was done after the modal collapses.
      onAutoMinimize: (summaryHtml: string) => {
        showStatusHtml(summaryHtml);
      },
    });

    // The modal owns the rest of the conversation from here. We don't await
    // it — release the inflight flag immediately so a re-open after close
    // doesn't deadlock. The modal itself guards against double-opens via
    // its own internal state.
    commandInflight = false;
    searchInput.blur();
  };

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    const raw = searchInput.value.trim();
    if (!raw) {
      return;
    }

    event.preventDefault();
    openModal(raw);
  });

  agentFilterClearBtn.addEventListener("click", () => {
    clearAgentFilter();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !agentFilter) {
      return;
    }

    // Modals (confirm or command) own Esc while open — let them handle it
    // first so we don't both clear the filter and close the modal in one
    // keystroke.
    const confirmModal = document.getElementById("bon-confirm-modal");
    if (confirmModal && !confirmModal.hidden) {
      return;
    }

    if (document.querySelector(".bon-cmd-modal-backdrop")) {
      return;
    }

    clearAgentFilter();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  });

  return {
    getAgentFilter: () => agentFilter,
    renderAgentFilterBanner,
  };
}

// Rotating placeholder pulled from a fixed list. Cross-fades by toggling the
// `--swap` class for one frame to drop opacity, swaps the placeholder text,
// then drops the class so the next example fades back in. Pauses while the
// operator has the bar focused or typed anything.
function installPlaceholderRotation(input: HTMLInputElement): void {
  let index = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cycle = (): void => {
    if (document.activeElement === input || input.value !== "") {
      return;
    }

    index = (index + 1) % BON_CMD_PLACEHOLDERS.length;
    input.classList.add("bon-command-bar-input--swap");

    setTimeout(() => {
      input.setAttribute("placeholder", BON_CMD_PLACEHOLDERS[index]);
      input.classList.remove("bon-command-bar-input--swap");
    }, 200);
  };

  const start = (): void => {
    if (timer !== null) {
      return;
    }

    timer = setInterval(cycle, BON_CMD_PLACEHOLDER_INTERVAL_MS);
  };

  const stop = (): void => {
    if (timer === null) {
      return;
    }

    clearInterval(timer);
    timer = null;
  };

  input.setAttribute("placeholder", BON_CMD_PLACEHOLDERS[0]);
  start();
  input.addEventListener("focus", stop);
  input.addEventListener("blur", () => {
    if (input.value === "") {
      start();
    }
  });
}
