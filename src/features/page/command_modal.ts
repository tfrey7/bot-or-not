// Live AI command modal — a chat conversation surface. Opens with the
// operator's initial prompt from the page command bar, then stays open
// across follow-ups. Each turn is rendered as a card in the scrolling
// conversation log: operator on top, agent below (action log + streamed
// reasoning prose). The footer holds a follow-up input that re-enables
// once the agent settles, so the operator can keep the thread going.
//
// The modal owns the runtime port lifecycle: opens one port per turn, pipes
// progress events into the current agent card, disconnects on cancel/close.
// Background-side conversation history persists across turns (and is reset
// when this modal opens) so the agent treats follow-ups as continuations.

import {
  aiCommandFormatBlock,
  type AiCommandProgressEvent,
  type AiCommandResult,
} from "../ai-command";
import { pageOpenConfirmModal } from "./confirm_modal.ts";
import { fmtUsd } from "../../utils/format_number.ts";

// Human-readable phrasing for each destructive tool the dispatcher gates
// before executing. Pulled into the confirm modal verbatim so the operator
// sees the exact action being requested, with the agent-supplied arguments
// resolved into the sentence.
function describeAiConfirmRequest(
  tool: string,
  input: Record<string, unknown>
): { text: string; confirmLabel: string } {
  const username = (input.username as string | undefined)?.trim() ?? "";
  const usernames = Array.isArray(input.usernames)
    ? (input.usernames as string[]).filter((u) => typeof u === "string")
    : [];

  if (tool === "delete_report") {
    return {
      text: `The AI command wants to delete u/${username || "?"} from the store. Approve?`,
      confirmLabel: "Delete",
    };
  }

  if (tool === "unlink_ring") {
    const list = usernames.map((u) => `u/${u}`).join(", ") || "?";
    return {
      text: `The AI command wants to clear the ring tag on ${list}. Approve?`,
      confirmLabel: "Unlink",
    };
  }

  if (tool === "set_user_status") {
    const status = (input.status as string | undefined) ?? "?";
    return {
      text: `The AI command wants to mark u/${username || "?"} as ${status}. Approve?`,
      confirmLabel: "Approve",
    };
  }

  return {
    text: `The AI command wants to run the destructive tool "${tool}". Approve?`,
    confirmLabel: "Approve",
  };
}

// Called once per agent turn that settles successfully (or partially via
// max-turns / abort). The reports page uses this to reload data and apply
// UI-side actions (navigate_to_user, filter_users).
//
// `sourceEl` is the page element the modal should appear to grow out of
// (and shrink back into on close) — the command bar wrapper. Passing null
// disables the FLIP morph and falls back to a straight fade.
//
// `onAutoMinimize` fires when the agent's turn ran tools and the modal is
// about to collapse back into the command bar. The caller renders the
// agent's final summary as a status line under the command bar so the
// operator can see what was done after the modal disappears.
export interface CommandModalDeps {
  sourceEl: HTMLElement | null;
  onTurnSettled(result: AiCommandResult): Promise<void>;
  onAutoMinimize?(summaryHtml: string): void;
}

type AgentTurnStatus = "running" | "done" | "error" | "aborted" | "max-turns";

interface ActionRow {
  el: HTMLLIElement;
  iconEl: HTMLSpanElement;
  detailEl: HTMLSpanElement;
}

// One agent turn's DOM handles. We keep a reference to the live turn while
// progress events stream in so the modal knows where to append text/actions.
interface AgentTurnHandles {
  el: HTMLElement;
  actionsSection: HTMLElement;
  actionsList: HTMLUListElement;
  reasoningSection: HTMLElement;
  reasoningEl: HTMLElement;
  reasoningTextEl: HTMLElement;
  metaEl: HTMLElement;
  actionRows: Map<string, ActionRow>;
  startedAt: number;
}

// A follow-up prompt that the operator submitted while a turn was still in
// flight. Each gets its own placeholder card in the conversation log so the
// operator can see what's lined up; the cards are promoted in order as
// earlier turns settle.
interface QueuedItem {
  prompt: string;
  cardEl: HTMLElement;
}

export function pageOpenCommandModal(
  initialPrompt: string,
  deps: CommandModalDeps
): void {
  // Fresh modal session = fresh conversation. Reset background-held history
  // so the agent starts from zero. This also handles the case where a prior
  // modal session bailed before completing.
  void browser.runtime
    .sendMessage({ type: "ai-command-reset" })
    .catch(() => {});

  const backdrop = document.createElement("div");
  backdrop.className = "bon-cmd-modal-backdrop";
  backdrop.setAttribute("role", "presentation");

  backdrop.innerHTML = `
    <div class="bon-cmd-modal bon-cmd-modal--chat" role="dialog" aria-modal="true" aria-labelledby="bon-cmd-modal-title">
      <header class="bon-cmd-modal-header">
        <span class="bon-cmd-modal-glyph" aria-hidden="true">
          <span class="bon-cmd-modal-glyph-spin">✦</span>
        </span>
        <span class="bon-cmd-modal-title" id="bon-cmd-modal-title">Bot or Not agent</span>
        <button type="button" class="bon-cmd-modal-close" aria-label="Close">×</button>
      </header>

      <div class="bon-cmd-modal-conversation" role="log" aria-live="polite"></div>

      <div class="bon-cmd-modal-statusbar">
        <span class="bon-cmd-modal-status">
          <span class="bon-cmd-modal-pip" aria-hidden="true"></span>
          <span class="bon-cmd-modal-status-text">Thinking…</span>
        </span>
        <span class="bon-cmd-modal-cost" hidden></span>
        <button type="button" class="bon-cmd-modal-cancel" hidden>Cancel</button>
      </div>

      <form class="bon-cmd-modal-composer" autocomplete="off">
        <span class="bon-cmd-modal-composer-prefix" aria-hidden="true">›</span>
        <input
          type="text"
          class="bon-cmd-modal-composer-input"
          placeholder="Follow up…"
          aria-label="Follow-up prompt"
          autocomplete="off"
          disabled
        />
        <button type="submit" class="bon-cmd-modal-composer-send" aria-label="Send" disabled>
          <span aria-hidden="true">↵</span>
        </button>
      </form>
    </div>
  `;

  const modalEl = backdrop.querySelector(".bon-cmd-modal") as HTMLElement;
  const conversationEl = backdrop.querySelector(
    ".bon-cmd-modal-conversation"
  ) as HTMLElement;
  const titleEl = backdrop.querySelector(".bon-cmd-modal-title") as HTMLElement;
  const statusTextEl = backdrop.querySelector(
    ".bon-cmd-modal-status-text"
  ) as HTMLElement;
  const statusPipEl = backdrop.querySelector(
    ".bon-cmd-modal-pip"
  ) as HTMLElement;
  const costEl = backdrop.querySelector(".bon-cmd-modal-cost") as HTMLElement;
  const cancelBtn = backdrop.querySelector(
    ".bon-cmd-modal-cancel"
  ) as HTMLButtonElement;
  const closeBtn = backdrop.querySelector(
    ".bon-cmd-modal-close"
  ) as HTMLButtonElement;
  const composerForm = backdrop.querySelector(
    ".bon-cmd-modal-composer"
  ) as HTMLFormElement;
  const composerInput = backdrop.querySelector(
    ".bon-cmd-modal-composer-input"
  ) as HTMLInputElement;
  const composerSend = backdrop.querySelector(
    ".bon-cmd-modal-composer-send"
  ) as HTMLButtonElement;

  let activePort: ReturnType<typeof browser.runtime.connect> | null = null;
  let currentTurn: AgentTurnHandles | null = null;
  let currentTurnSettled = false;
  let cancelled = false;
  let inflight = false;
  let closed = false;
  let totalCostUsd: number | null = null;
  let autoMinimizeTimer: ReturnType<typeof setTimeout> | null = null;
  let autoMinimizeFired = false;
  const queued: QueuedItem[] = [];

  // One operator card per consecutive queued group — every queued prompt is
  // an <li> inside this card's list, so the chrome ("queued · N", border,
  // label) doesn't repeat per item.
  let queuedGroupEl: HTMLElement | null = null;

  const setOverallStatus = (
    status: AgentTurnStatus,
    label: string,
    options: { showCancel?: boolean } = {}
  ): void => {
    statusTextEl.textContent = label;
    modalEl.dataset.status = status;
    statusPipEl.dataset.status = status;
    cancelBtn.hidden = !options.showCancel;
  };

  // The composer stays enabled while a turn is in flight — submitting from
  // there queues a follow-up rather than blocking. The visible mode just
  // tells the operator whether Enter will send-now or queue-after. Focus
  // grabs in both modes: when the modal is alive, the operator's next
  // keystroke should land in the input without an intermediate click.
  const setComposerMode = (mode: "idle" | "queueing"): void => {
    composerInput.disabled = false;
    composerSend.disabled = false;
    composerForm.dataset.state = mode;

    if (mode === "idle") {
      composerInput.placeholder = "Follow up…";
      composerSend.title = "Send (Enter)";
    } else {
      composerInput.placeholder = "Queue a follow-up…";
      composerSend.title = "Queue this message (Enter)";
    }

    composerInput.focus();
  };

  const renderTotalCost = (): void => {
    if (totalCostUsd === null) {
      costEl.hidden = true;
      return;
    }

    costEl.hidden = false;
    costEl.textContent = fmtUsd(totalCostUsd);
  };

  const scrollConversationToBottom = (): void => {
    // Use scrollHeight directly — smooth scroll inside a flexed/contained
    // panel can fight other layout updates and stutter.
    conversationEl.scrollTop = conversationEl.scrollHeight;
  };

  const appendOperatorTurn = (text: string): HTMLElement => {
    const card = document.createElement("div");
    card.className = "bon-cmd-turn bon-cmd-turn--operator";
    card.innerHTML = `
      <p class="bon-cmd-turn-label">Operator</p>
      <p class="bon-cmd-turn-text"></p>
    `;
    const textEl = card.querySelector(".bon-cmd-turn-text") as HTMLElement;
    textEl.textContent = text;
    conversationEl.appendChild(card);
    scrollConversationToBottom();
    return card;
  };

  // Promote the queued-group card into a regular operator card with the
  // combined text. Strips queued styling and replaces the list body with a
  // single text block. Used by the flush path so the card stays in place
  // (no jarring DOM churn) and gains the agent's reply directly below.
  const promoteOperatorCard = (card: HTMLElement): void => {
    card.classList.remove("bon-cmd-turn--queued");
  };

  const createQueuedGroupCard = (): HTMLElement => {
    const card = document.createElement("div");
    card.className = "bon-cmd-turn bon-cmd-turn--operator bon-cmd-turn--queued";
    card.innerHTML = `
      <p class="bon-cmd-turn-label">
        <span class="bon-cmd-turn-queued-tag" aria-hidden="true">queued</span>
      </p>
      <ul class="bon-cmd-turn-queued-list"></ul>
    `;

    return card;
  };

  const appendQueuedItem = (
    group: HTMLElement,
    text: string
  ): HTMLLIElement => {
    const list = group.querySelector(
      ".bon-cmd-turn-queued-list"
    ) as HTMLUListElement;

    const item = document.createElement("li");
    item.className = "bon-cmd-turn-queued-item";
    item.innerHTML = `
      <p class="bon-cmd-turn-text"></p>
      <button type="button" class="bon-cmd-turn-cancel" aria-label="Drop queued message">×</button>
    `;

    const textEl = item.querySelector(".bon-cmd-turn-text") as HTMLElement;
    textEl.textContent = text;

    const cancelBtn = item.querySelector(
      ".bon-cmd-turn-cancel"
    ) as HTMLButtonElement;
    cancelBtn.addEventListener("click", () => {
      removeQueuedItem(item);
    });

    list.appendChild(item);
    return item;
  };

  const updateQueuedTag = (): void => {
    if (!queuedGroupEl) {
      return;
    }

    const tag = queuedGroupEl.querySelector(
      ".bon-cmd-turn-queued-tag"
    ) as HTMLElement | null;

    if (!tag) {
      return;
    }

    tag.textContent =
      queued.length > 1 ? `queued · ${queued.length}` : "queued";
  };

  const startAgentTurn = (afterEl: HTMLElement): AgentTurnHandles => {
    const card = document.createElement("div");
    card.className = "bon-cmd-turn bon-cmd-turn--agent";
    card.innerHTML = `
      <p class="bon-cmd-turn-label">
        <span class="bon-cmd-turn-glyph" aria-hidden="true">✦</span> Agent
      </p>
      <section class="bon-cmd-turn-actions-section" hidden>
        <ul class="bon-cmd-turn-actions-list"></ul>
      </section>
      <section class="bon-cmd-turn-reasoning-section" hidden>
        <div class="bon-cmd-turn-reasoning bon-cmd-turn-reasoning--streaming">
          <span class="bon-cmd-turn-reasoning-text"></span><span class="bon-cmd-stream-caret" aria-hidden="true"></span>
        </div>
      </section>
      <p class="bon-cmd-turn-meta" hidden></p>
    `;

    // Insert right after the operator card it answers. With queued follow-
    // ups, the conversation log may have later (still-queued) operator cards
    // below — we want the agent's response to land between them, not at the
    // bottom of the log.
    conversationEl.insertBefore(card, afterEl.nextSibling);
    scrollConversationToBottom();

    const handles: AgentTurnHandles = {
      el: card,
      actionsSection: card.querySelector(
        ".bon-cmd-turn-actions-section"
      ) as HTMLElement,
      actionsList: card.querySelector(
        ".bon-cmd-turn-actions-list"
      ) as HTMLUListElement,
      reasoningSection: card.querySelector(
        ".bon-cmd-turn-reasoning-section"
      ) as HTMLElement,
      reasoningEl: card.querySelector(".bon-cmd-turn-reasoning") as HTMLElement,
      reasoningTextEl: card.querySelector(
        ".bon-cmd-turn-reasoning-text"
      ) as HTMLElement,
      metaEl: card.querySelector(".bon-cmd-turn-meta") as HTMLElement,
      actionRows: new Map(),
      startedAt: performance.now(),
    };

    return handles;
  };

  const ensureActionRow = (
    turn: AgentTurnHandles,
    id: string,
    tool: string
  ) => {
    const existing = turn.actionRows.get(id);
    if (existing) {
      return existing;
    }

    turn.actionsSection.hidden = false;

    const li = document.createElement("li");
    li.className = "bon-cmd-modal-action bon-cmd-modal-action--pending";

    const icon = document.createElement("span");
    icon.className = "bon-cmd-modal-action-icon";
    icon.textContent = "◌";
    li.appendChild(icon);

    const label = document.createElement("span");
    label.className = "bon-cmd-modal-action-label";
    label.textContent = tool;
    li.appendChild(label);

    const detail = document.createElement("span");
    detail.className = "bon-cmd-modal-action-detail";
    li.appendChild(detail);

    turn.actionsList.appendChild(li);
    scrollConversationToBottom();

    const row: ActionRow = {
      el: li,
      iconEl: icon,
      detailEl: detail,
    };

    turn.actionRows.set(id, row);
    return row;
  };

  const setActionDetail = (
    row: ActionRow,
    detail: string,
    extraClass?: string
  ): void => {
    row.detailEl.textContent = detail;
    row.detailEl.className = extraClass
      ? `bon-cmd-modal-action-detail ${extraClass}`
      : "bon-cmd-modal-action-detail";
  };

  const handleProgress = (event: AiCommandProgressEvent): void => {
    if (closed || !currentTurn) {
      return;
    }

    const turn = currentTurn;

    if (event.kind === "turn-start") {
      if (event.turn > 0) {
        setOverallStatus("running", "Following up on tool results…", {
          showCancel: true,
        });
      }

      return;
    }

    if (event.kind === "model") {
      return;
    }

    if (event.kind === "assistant-text-delta") {
      turn.reasoningSection.hidden = false;

      const chunk = document.createElement("span");
      chunk.className = "bon-cmd-stream-chunk";
      chunk.textContent = event.text;
      turn.reasoningTextEl.appendChild(chunk);
      setOverallStatus("running", "Writing…", { showCancel: true });
      scrollConversationToBottom();
      return;
    }

    if (event.kind === "tool-use-start") {
      ensureActionRow(turn, event.id, event.tool);
      setOverallStatus("running", `Calling ${event.tool}…`, {
        showCancel: true,
      });

      return;
    }

    if (event.kind === "tool-use-input") {
      const row = ensureActionRow(turn, event.id, event.tool);
      row.el.classList.remove("bon-cmd-modal-action--pending");
      row.el.classList.add("bon-cmd-modal-action--running");
      row.iconEl.textContent = "↻";

      const summary = summarizeToolInput(event.tool, event.input);
      if (summary) {
        setActionDetail(row, summary);
      }

      setOverallStatus("running", `Running ${event.tool}…`, {
        showCancel: true,
      });

      return;
    }

    if (event.kind === "tool-use-end") {
      const row = ensureActionRow(turn, event.id, event.tool);
      row.el.classList.remove(
        "bon-cmd-modal-action--pending",
        "bon-cmd-modal-action--running"
      );

      if (event.ok) {
        row.el.classList.add("bon-cmd-modal-action--ok");
        row.iconEl.textContent = "✓";

        const resultSummary = summarizeToolResult(event.tool, event.result);
        if (resultSummary) {
          const existing = row.detailEl.textContent ?? "";
          setActionDetail(
            row,
            existing ? `${existing} · ${resultSummary}` : resultSummary
          );
        }
      } else {
        row.el.classList.add("bon-cmd-modal-action--error");
        row.iconEl.textContent = "✗";
        setActionDetail(
          row,
          event.error ?? "error",
          "bon-cmd-modal-action-detail--error"
        );
      }

      return;
    }

    if (event.kind === "cost") {
      if (event.costUsd !== null) {
        totalCostUsd = event.costUsd;
        renderTotalCost();
      }

      return;
    }
  };

  const formatTurnElapsed = (startedAt: number): string => {
    const ms = performance.now() - startedAt;
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }

    return `${(ms / 1000).toFixed(1)}s`;
  };

  const finalizeTurn = (
    turn: AgentTurnHandles,
    result: AiCommandResult
  ): void => {
    // Replace the streamed text with the formatted version so inline markdown
    // (italic/bold/code) renders properly. Block formatter preserves newlines
    // so multi-paragraph answers don't collapse.
    if (result.summary) {
      turn.reasoningSection.hidden = false;
      turn.reasoningTextEl.innerHTML = aiCommandFormatBlock(result.summary);
    }

    turn.reasoningEl.classList.remove("bon-cmd-turn-reasoning--streaming");

    const elapsed = formatTurnElapsed(turn.startedAt);
    const metaParts: string[] = [];
    if (result.error === "max-turns-exceeded") {
      metaParts.push("stopped at max turns");
    } else if (result.error === "aborted") {
      metaParts.push("cancelled");
    } else if (!result.ok) {
      metaParts.push(`failed: ${result.error ?? "unknown error"}`);
    }

    metaParts.push(elapsed);

    if (result.costUsd !== null && totalCostUsd !== null) {
      // Show the turn's own cost share rather than the running total, so each
      // card carries its own price tag — the running total lives in the
      // header status bar.
      const turnCost = result.costUsd > 0 ? fmtUsd(result.costUsd) : null;
      if (turnCost) {
        metaParts.push(turnCost);
      }
    }

    turn.metaEl.hidden = false;
    turn.metaEl.textContent = metaParts.join(" · ");

    if (result.error === "max-turns-exceeded") {
      turn.el.classList.add("bon-cmd-turn--max-turns");
    } else if (result.error === "aborted") {
      turn.el.classList.add("bon-cmd-turn--aborted");
    } else if (!result.ok) {
      turn.el.classList.add("bon-cmd-turn--error");
    }

    scrollConversationToBottom();
  };

  const showTurnError = (turn: AgentTurnHandles, error: string): void => {
    turn.reasoningSection.hidden = false;
    turn.reasoningEl.classList.remove("bon-cmd-turn-reasoning--streaming");
    turn.reasoningTextEl.textContent = error;
    turn.el.classList.add("bon-cmd-turn--error");
    turn.metaEl.hidden = false;
    turn.metaEl.textContent = `failed · ${formatTurnElapsed(turn.startedAt)}`;
    scrollConversationToBottom();
  };

  const handleResult = async (result: AiCommandResult): Promise<void> => {
    if (closed || !currentTurn || currentTurnSettled) {
      return;
    }

    currentTurnSettled = true;
    finalizeTurn(currentTurn, result);

    try {
      await deps.onTurnSettled(result);
    } catch (error) {
      console.error("[Bot or Not] onTurnSettled failed", error);
    }

    if (result.error === "max-turns-exceeded") {
      setOverallStatus("max-turns", "Stopped after maximum turns");
    } else if (result.error === "aborted") {
      setOverallStatus("aborted", "Cancelled — ready when you are");
    } else if (!result.ok) {
      setOverallStatus("error", result.error ?? "Failed");
    } else {
      setOverallStatus("done", "Done — ask another");
    }

    inflight = false;

    // If the operator queued follow-ups while this turn was running, flush
    // them all as one combined prompt — they're parts of the same ask,
    // typed in sequence only because the previous turn was busy.
    if (flushQueuedAsCombinedTurn()) {
      return;
    }

    setComposerMode("idle");

    // Auto-minimize is only appropriate for the LAST turn of a session — if
    // the operator is mid-conversation and queued a follow-up (drained
    // above), we never reach this point. With nothing queued and the agent
    // having taken concrete action, collapse back into the command bar.
    if (
      result.ok &&
      result.actions.some((action) => action.ok) &&
      deps.onAutoMinimize
    ) {
      const summaryHtml = result.summary
        ? aiCommandFormatBlock(result.summary)
        : "Done.";
      scheduleAutoMinimize(summaryHtml);
    }
  };

  const handleTurnError = (error: string): void => {
    if (closed || !currentTurn || currentTurnSettled) {
      return;
    }

    currentTurnSettled = true;
    showTurnError(currentTurn, error);
    setOverallStatus("error", "Failed");
    inflight = false;

    // Flush any queued follow-ups as a single combined turn even after an
    // error — the operator's queued ask is independent of the failed turn,
    // and they can read the error above while the combined turn streams.
    if (flushQueuedAsCombinedTurn()) {
      return;
    }

    setComposerMode("idle");
  };

  const queuePrompt = (input: string): void => {
    cancelAutoMinimize();

    if (!queuedGroupEl) {
      queuedGroupEl = createQueuedGroupCard();
      conversationEl.appendChild(queuedGroupEl);
    }

    const itemEl = appendQueuedItem(queuedGroupEl, input);
    queued.push({ prompt: input, cardEl: itemEl });
    updateQueuedTag();
    scrollConversationToBottom();
  };

  const removeQueuedItem = (itemEl: HTMLElement): void => {
    const idx = queued.findIndex((item) => item.cardEl === itemEl);
    if (idx < 0) {
      return;
    }

    queued.splice(idx, 1);
    itemEl.remove();

    if (queued.length === 0 && queuedGroupEl) {
      queuedGroupEl.remove();
      queuedGroupEl = null;
    } else {
      updateQueuedTag();
    }

    scrollConversationToBottom();
  };

  const drainQueue = (): void => {
    if (queuedGroupEl) {
      queuedGroupEl.remove();
      queuedGroupEl = null;
    }

    queued.length = 0;
  };

  // After a turn settles, flush all queued follow-ups as ONE combined turn
  // — they were typed in sequence only because the previous turn was busy,
  // so they're really parts of the same ask. Each queued prompt becomes its
  // own right-aligned operator bubble (chat-app convention: a burst of
  // texts shows as a stack of bubbles, not one merged block), and the
  // agent's reply lands after the last one. Returns true if a flush
  // happened so the caller skips the normal idle path.
  const flushQueuedAsCombinedTurn = (): boolean => {
    if (queued.length === 0 || !queuedGroupEl) {
      return false;
    }

    const items = queued.splice(0, queued.length);
    const combinedPrompt = items.map((item) => item.prompt).join("\n\n");

    queuedGroupEl.remove();
    queuedGroupEl = null;

    let lastCard: HTMLElement | null = null;

    for (const item of items) {
      lastCard = appendOperatorTurn(item.prompt);
    }

    cancelAutoMinimize();
    runTurn(combinedPrompt, lastCard ?? undefined);
    return true;
  };

  const runTurn = (input: string, existingCard?: HTMLElement): void => {
    if (inflight || closed) {
      return;
    }

    inflight = true;
    cancelled = false;
    setComposerMode("queueing");
    setOverallStatus("running", "Thinking…", { showCancel: true });

    const operatorCard = existingCard
      ? (promoteOperatorCard(existingCard), existingCard)
      : appendOperatorTurn(input);
    currentTurn = startAgentTurn(operatorCard);
    currentTurnSettled = false;

    const port = browser.runtime.connect({ name: "ai-command" });
    activePort = port;

    port.onMessage.addListener((message: unknown) => {
      const envelope = message as {
        kind?: string;
        event?: AiCommandProgressEvent;
        result?: AiCommandResult;
        error?: string;
        id?: number;
        tool?: string;
        input?: Record<string, unknown>;
      };

      if (envelope.kind === "progress" && envelope.event) {
        handleProgress(envelope.event);
        return;
      }

      if (
        envelope.kind === "confirm-request" &&
        typeof envelope.id === "number" &&
        envelope.tool
      ) {
        const id = envelope.id;
        const { text, confirmLabel } = describeAiConfirmRequest(
          envelope.tool,
          envelope.input ?? {}
        );
        const reply = (approved: boolean): void => {
          try {
            port.postMessage({
              type: "ai-command:confirm-reply",
              id,
              approved,
            });
          } catch {
            // Port already gone — background's onDisconnect handler will
            // resolve any awaiting confirms as denied.
          }
        };

        pageOpenConfirmModal({
          text,
          confirmLabel,
          action: () => reply(true),
          onCancel: () => reply(false),
          skipPostConfirm: true,
        });

        return;
      }

      if (envelope.kind === "result" && envelope.result) {
        void handleResult(envelope.result);
        return;
      }

      if (envelope.kind === "error") {
        const message = envelope.error ?? "unknown error";
        if (message === "no-api-key") {
          handleTurnError("No Claude API key — add one in Settings.");
        } else {
          handleTurnError(`Command failed: ${message}`);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      if (activePort === port) {
        activePort = null;
      }

      if (currentTurnSettled || closed) {
        return;
      }

      if (cancelled) {
        // Synthesize an aborted result so the modal renders cleanly without
        // bouncing through deps.onTurnSettled with an empty actions list.
        const aborted: AiCommandResult = {
          ok: false,
          summary: "Cancelled.",
          actions: [],
          costUsd: null,
          model: "",
          history: [],
          error: "aborted",
        };
        void handleResult(aborted);
        return;
      }

      handleTurnError("Agent disconnected unexpectedly.");
    });

    try {
      port.postMessage({ type: "ai-command:start", input });
    } catch (error) {
      handleTurnError(
        String((error as { message?: string })?.message ?? error)
      );
    }
  };

  const cancelCurrentTurn = (): void => {
    if (!inflight || !activePort) {
      return;
    }

    cancelled = true;

    // Cancel = bail-out: drop any queued follow-ups too. Operator intent is
    // "stop", not "skip the current turn and run the next one."
    drainQueue();
    try {
      activePort.disconnect();
    } catch {
      // Already gone.
    }
  };

  const prefersReducedMotion = (): boolean => {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  };

  // FLIP morph helpers. The modal "grows" out of (and "shrinks" back into)
  // the source command bar by computing an inline transform that maps the
  // modal's natural bbox onto the source's bbox, then transitioning to (or
  // from) identity. `transform-origin: 0 0` keeps the math simple — translate
  // shifts top-left, scale scales around top-left, no centering math.
  const computeMorphTransform = (): string | null => {
    if (!deps.sourceEl) {
      return null;
    }

    const sourceRect = deps.sourceEl.getBoundingClientRect();
    if (sourceRect.width === 0 || sourceRect.height === 0) {
      return null;
    }

    // Get the modal's bbox at its natural position. Caller is responsible
    // for clearing any inline transform first if needed.
    const modalRect = modalEl.getBoundingClientRect();
    if (modalRect.width === 0 || modalRect.height === 0) {
      return null;
    }

    const tx = sourceRect.left - modalRect.left;
    const ty = sourceRect.top - modalRect.top;
    const sx = sourceRect.width / modalRect.width;
    const sy = sourceRect.height / modalRect.height;

    return `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
  };

  const scheduleAutoMinimize = (summaryHtml: string): void => {
    if (autoMinimizeTimer !== null) {
      clearTimeout(autoMinimizeTimer);
    }

    // 750ms — long enough for the success state (green pip, "Done") to
    // register, short enough that the modal doesn't overstay.
    autoMinimizeTimer = setTimeout(() => {
      autoMinimizeTimer = null;

      if (closed || autoMinimizeFired) {
        return;
      }

      // If the user has typed something in the composer, they're engaged
      // with the conversation — don't yank the modal away mid-thought.
      if (composerInput.value.trim() !== "") {
        return;
      }

      autoMinimizeFired = true;
      deps.onAutoMinimize?.(summaryHtml);
      close();
    }, 750);
  };

  const cancelAutoMinimize = (): void => {
    if (autoMinimizeTimer !== null) {
      clearTimeout(autoMinimizeTimer);
      autoMinimizeTimer = null;
    }
  };

  const close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    cancelAutoMinimize();
    drainQueue();
    document.removeEventListener("keydown", onKeyDown);

    if (activePort) {
      cancelled = true;
      try {
        activePort.disconnect();
      } catch {
        // Already gone.
      }
    }

    // Morph back into the command bar if we have a source and motion is
    // enabled. Otherwise just fade.
    const morph = prefersReducedMotion() ? null : computeMorphTransform();
    if (morph) {
      modalEl.style.transformOrigin = "0 0";
      modalEl.style.transition =
        "transform 0.32s cubic-bezier(0.4, 0, 0.7, 1), opacity 0.24s ease-in 0.06s";
      modalEl.style.transform = morph;
      modalEl.style.opacity = "0";
    }

    backdrop.classList.add("bon-cmd-modal-backdrop--out");
    setTimeout(
      () => {
        backdrop.remove();
        document.body.style.overflow = previousBodyOverflow;
      },
      morph ? 340 : 200
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }

    if (inflight) {
      event.preventDefault();
      cancelCurrentTurn();
      return;
    }

    event.preventDefault();
    close();
  };

  document.addEventListener("keydown", onKeyDown);

  cancelBtn.addEventListener("click", () => {
    cancelCurrentTurn();
  });

  closeBtn.addEventListener("click", () => {
    close();
  });

  backdrop.addEventListener("click", (event) => {
    if (event.target !== backdrop) {
      return;
    }

    if (inflight) {
      cancelCurrentTurn();
      return;
    }

    close();
  });

  composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = composerInput.value.trim();
    if (!raw || closed) {
      return;
    }

    composerInput.value = "";

    // If a turn is in flight, queue the follow-up rather than blocking on
    // it. The queued operator card appears in the log immediately so the
    // operator can see what's lined up (and drop it via × if they change
    // their mind).
    if (inflight) {
      queuePrompt(raw);
    } else {
      runTurn(raw);
    }
  });

  // Operator typing a follow-up = "I'm engaged" → cancel any pending auto-
  // minimize so the modal doesn't yank away mid-keystroke. We listen on the
  // `input` event rather than `focus` so the programmatic `.focus()` call
  // after a turn settles doesn't accidentally cancel.
  composerInput.addEventListener("input", cancelAutoMinimize);

  // Lock the page's scroll while the modal is open — wheel events over the
  // backdrop or modal contents shouldn't leak through and drift the report
  // list behind. Restore on close.
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  document.body.appendChild(backdrop);

  // FLIP morph in. Capture the modal's natural bbox after append (one
  // layout), set an inline transform that places it at the source command
  // bar's bbox, then transition back to identity. The conic ring + glow
  // come along for the ride.
  const initialMorph = prefersReducedMotion() ? null : computeMorphTransform();
  if (initialMorph) {
    modalEl.style.transformOrigin = "0 0";
    modalEl.style.transform = initialMorph;
    modalEl.style.opacity = "0";

    // Force layout so the starting transform is committed before we kick
    // off the transition in the next frame.
    void modalEl.offsetWidth;
  }

  requestAnimationFrame(() => {
    backdrop.classList.add("bon-cmd-modal-backdrop--in");
    if (initialMorph) {
      modalEl.style.transition =
        "transform 0.38s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.28s ease-out";
      modalEl.style.transform = "";
      modalEl.style.opacity = "";
    }
  });

  // Fire off the operator's first prompt now that the chrome is mounted.
  runTurn(initialPrompt);

  // Keep the title quietly factual — the live status pip + per-turn cards
  // carry all the dynamic state.
  titleEl.textContent = "Bot or Not agent";
}

// Human-readable summary of a tool's input. Keep these terse — they ride
// next to the tool name in the action log. The action log row is one line
// so we don't try to surface every argument, just the most useful one.
function summarizeToolInput(
  tool: string,
  input: Record<string, unknown>
): string {
  if (tool === "filter_users") {
    const label = typeof input.label === "string" ? input.label.trim() : "";
    const usernames = Array.isArray(input.usernames)
      ? (input.usernames as unknown[])
      : [];
    const count = usernames.length;
    if (label && count > 0) {
      return `${label} · ${count} ${count === 1 ? "user" : "users"}`;
    }

    if (label) {
      return label;
    }

    if (count === 0) {
      return "clear filter";
    }

    return `${count} ${count === 1 ? "user" : "users"}`;
  }

  if (tool === "read_user_details") {
    const usernames = Array.isArray(input.usernames)
      ? (input.usernames as unknown[])
      : [];

    if (usernames.length <= 3) {
      return usernames.map((u) => `u/${u}`).join(", ");
    }

    return `${usernames.length} users`;
  }

  if (tool === "link_ring" || tool === "unlink_ring") {
    const usernames = Array.isArray(input.usernames)
      ? (input.usernames as string[])
      : [];

    if (usernames.length <= 3) {
      return usernames.map((u) => `u/${u}`).join(", ");
    }

    return `${usernames.length} users`;
  }

  if (
    tool === "investigate_user" ||
    tool === "delete_report" ||
    tool === "navigate_to_user"
  ) {
    const username = typeof input.username === "string" ? input.username : "";
    return username ? `u/${username}` : "";
  }

  if (tool === "set_user_status") {
    const username = typeof input.username === "string" ? input.username : "";
    const status = typeof input.status === "string" ? input.status : "";
    if (username && status) {
      return `u/${username} → ${status}`;
    }

    return username ? `u/${username}` : "";
  }

  return "";
}

// Optional "result tail" — a short addition to the row once the tool has
// returned (e.g. "kicked off", "3 found"). Keep null for tools where the
// successful state is obvious from the icon.
function summarizeToolResult(tool: string, result: unknown): string | null {
  if (tool === "investigate_user") {
    return "kicked off";
  }

  if (tool === "filter_users") {
    const count = (result as { count?: number } | undefined)?.count;
    if (typeof count === "number") {
      return `${count} ${count === 1 ? "match" : "matches"}`;
    }
  }

  if (tool === "navigate_to_user") {
    const username = (result as { username?: string } | undefined)?.username;
    if (username) {
      return `opened u/${username}`;
    }
  }

  return null;
}
