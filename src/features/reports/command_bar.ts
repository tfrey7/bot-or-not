// AI command bar — the Enter-to-run search input, the agent-filter banner,
// and the runAiCommand / applyClientActions pipeline. The orchestrator wires
// this up once and queries the agent filter from its own render() so
// visibility matches the bar's state. Since the input was made a pure
// command box, it doesn't double as a row filter — every Enter is a
// command to the agent.

import {
  bonAiCommandFormatSummary,
  type AiCommandAction,
  type AiCommandResult,
} from "../ai-command";
import type { ReportRow } from "./logic.ts";

export interface BonReportsCommandBarDeps {
  searchInput: HTMLInputElement;
  commandStatusEl: HTMLElement;
  agentFilterEl: HTMLElement;
  agentFilterLabelEl: HTMLElement;
  agentFilterClearBtn: HTMLButtonElement;
  getReports(): ReportRow[];
  onAgentFilterChange(): void;
  onNavigateToUser(username: string): void;
  onCommandReload(): Promise<void>;
}

export interface BonReportsCommandBarHandle {
  getAgentFilter(): ReadonlySet<string> | null;
  renderAgentFilterBanner(): void;
}

export function bonReportsInitCommandBar(
  deps: BonReportsCommandBarDeps
): BonReportsCommandBarHandle {
  const {
    searchInput,
    commandStatusEl,
    agentFilterEl,
    agentFilterLabelEl,
    agentFilterClearBtn,
  } = deps;

  let agentFilter: Set<string> | null = null;
  let agentFilterLabel = "";
  let commandInflight = false;

  // Each fresh load of the reports page starts a new AI conversation. The
  // background keeps the transcript across messages within one page session,
  // but a refresh wipes it — keeps the lifetime intuitive and avoids needing
  // any user-facing reset control.
  void browser.runtime
    .sendMessage({ type: "ai-command-reset" })
    .catch(() => {});

  const setCommandStatus = (
    kind: "running" | "ok" | "error",
    content: string,
    options: { html?: boolean } = {}
  ): void => {
    commandStatusEl.hidden = false;
    if (options.html) {
      commandStatusEl.innerHTML = content;
    } else {
      commandStatusEl.textContent = content;
    }

    commandStatusEl.classList.remove(
      "bon-command-status--running",
      "bon-command-status--ok",
      "bon-command-status--error"
    );
    commandStatusEl.classList.add(`bon-command-status--${kind}`);
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

  const runAiCommand = async (input: string): Promise<void> => {
    if (commandInflight) {
      return;
    }

    commandInflight = true;
    searchInput.disabled = true;
    setCommandStatus("running", `Running: ${input}`);

    try {
      const response = (await browser.runtime.sendMessage({
        type: "ai-command",
        input,
      })) as AiCommandResult | { ok: false; error: string };

      if (!response?.ok) {
        const error =
          (response as { error?: string })?.error ?? "unknown error";

        if (error === "no-api-key") {
          setCommandStatus("error", "No Claude API key — add one in Settings.");
        } else {
          setCommandStatus("error", `Command failed: ${error}`);
        }

        return;
      }

      const result = response as AiCommandResult;
      const summary = bonAiCommandFormatSummary(result.summary);
      setCommandStatus("ok", summary, { html: true });
      searchInput.value = "";
      await deps.onCommandReload();
      applyClientActions(result.actions);
    } catch (error) {
      console.error("[Bot or Not] ai-command failed", error);
      setCommandStatus(
        "error",
        `Command failed: ${String(
          (error as { message?: string })?.message ?? error
        )}`
      );
    } finally {
      commandInflight = false;
      searchInput.disabled = false;
      searchInput.focus();
    }
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
    void runAiCommand(raw);
  });

  agentFilterClearBtn.addEventListener("click", () => {
    clearAgentFilter();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !agentFilter) {
      return;
    }

    // The confirm modal's own Esc handler runs alongside this one; if it's
    // open, let it win and leave the filter for the next Esc press.
    const confirmModal = document.getElementById("bon-confirm-modal");
    if (confirmModal && !confirmModal.hidden) {
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
