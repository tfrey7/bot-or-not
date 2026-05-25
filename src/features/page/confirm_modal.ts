// "Are you sure" modal shared by clear-all and per-row delete actions.
// Wire-up takes a callback that re-runs `load()` after a destructive
// action completes.

const modal = document.getElementById("bon-confirm-modal") as HTMLElement;
const modalText = document.getElementById("bon-modal-text") as HTMLElement;
const cancelBtn = document.getElementById(
  "bon-cancel-clear"
) as HTMLButtonElement;
const confirmBtn = document.getElementById(
  "bon-confirm-clear"
) as HTMLButtonElement;

let pendingConfirmAction: (() => Promise<unknown> | unknown) | null = null;
let pendingCancelAction: (() => void) | null = null;

// When the AI command dispatcher gates a destructive tool through this modal,
// the parent reports page shouldn't trigger its own re-load on confirm —
// storage.onChanged will fire naturally once the tool actually executes.
let skipPostConfirmHook = false;

export interface ConfirmModalOpts {
  text: string;
  confirmLabel: string;
  action: () => Promise<unknown> | unknown;

  // Fires on Esc, backdrop click, or Cancel-button click. Useful when the
  // caller needs to signal "operator declined" upstream (e.g. resolving an
  // awaiting promise with false).
  onCancel?: () => void;

  // Set when the action does not directly mutate storage from this page's
  // context (the AI command flow only resolves a promise; the real mutation
  // happens in the background dispatcher afterwards). Suppresses the
  // page-level post-confirm hook so we don't fire a redundant reload.
  skipPostConfirm?: boolean;
}

export function pageOpenConfirmModal({
  text,
  confirmLabel,
  action,
  onCancel,
  skipPostConfirm,
}: ConfirmModalOpts): void {
  modalText.textContent = text;
  confirmBtn.textContent = confirmLabel;
  pendingConfirmAction = action;
  pendingCancelAction = onCancel ?? null;
  skipPostConfirmHook = !!skipPostConfirm;

  modal.hidden = false;
  cancelBtn.focus();
}

function closeConfirmModal(
  { cancelled }: { cancelled: boolean } = {
    cancelled: true,
  }
): void {
  modal.hidden = true;
  const cancelFn = pendingCancelAction;
  pendingConfirmAction = null;
  pendingCancelAction = null;
  if (cancelled && cancelFn) {
    cancelFn();
  }
}

export function pageInitConfirmModal({
  onConfirm,
}: {
  onConfirm: () => Promise<void> | void;
}): void {
  cancelBtn.addEventListener("click", () => closeConfirmModal());

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeConfirmModal();
    }
  });

  confirmBtn.addEventListener("click", async () => {
    if (!pendingConfirmAction) {
      return;
    }

    const action = pendingConfirmAction;
    const skipHook = skipPostConfirmHook;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      await action();
      closeConfirmModal({ cancelled: false });
      if (!skipHook) {
        await onConfirm();
      }
    } catch (error) {
      console.error("[Bot or Not] confirm action failed", error);
    } finally {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeConfirmModal();
    }
  });
}
