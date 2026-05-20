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

export interface ConfirmModalOpts {
  text: string;
  confirmLabel: string;
  action: () => Promise<unknown> | unknown;
}

export function bonReportsOpenConfirmModal({
  text,
  confirmLabel,
  action,
}: ConfirmModalOpts): void {
  modalText.textContent = text;
  confirmBtn.textContent = confirmLabel;
  pendingConfirmAction = action;

  modal.hidden = false;
  cancelBtn.focus();
}

function closeConfirmModal(): void {
  modal.hidden = true;
  pendingConfirmAction = null;
}

export function bonReportsInitConfirmModal({
  onConfirm,
}: {
  onConfirm: () => Promise<void> | void;
}): void {
  cancelBtn.addEventListener("click", closeConfirmModal);

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
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      await action();
      closeConfirmModal();
      await onConfirm();
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
