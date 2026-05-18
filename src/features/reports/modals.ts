// Both modals on the reports page: the "are you sure" confirm modal
// (clear-all + per-row delete) and the Claude API key settings modal.
// Wire-up is split into two init functions so the orchestrator can hand
// each one its specific buttons + a callback that re-runs `load()` after
// a destructive action completes.

const modal = document.getElementById("bon-confirm-modal") as HTMLElement;
const modalText = document.getElementById("bon-modal-text") as HTMLElement;
const cancelBtn = document.getElementById(
  "bon-cancel-clear"
) as HTMLButtonElement;
const confirmBtn = document.getElementById(
  "bon-confirm-clear"
) as HTMLButtonElement;

const settingsBtn = document.getElementById(
  "bon-settings-btn"
) as HTMLButtonElement;
const settingsModal = document.getElementById(
  "bon-settings-modal"
) as HTMLElement;
const settingsCancel = document.getElementById(
  "bon-settings-cancel"
) as HTMLButtonElement;
const settingsSave = document.getElementById(
  "bon-settings-save"
) as HTMLButtonElement;
const apiKeyInput = document.getElementById(
  "bon-api-key-input"
) as HTMLInputElement;
const apiKeyStatus = document.getElementById(
  "bon-api-key-status"
) as HTMLElement;

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
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
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
    } catch (err) {
      console.error("[Bot or Not] confirm action failed", err);
    } finally {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });
}

function renderApiKeyStatus(hasKey: boolean): void {
  if (hasKey) {
    apiKeyStatus.textContent =
      "Key set. Type a new one to replace, or leave blank to keep.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--set";
    apiKeyInput.placeholder = "•••• (key on file)";
  } else {
    apiKeyStatus.textContent =
      "No key set. Investigations will fail until one is saved.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
    apiKeyInput.placeholder = "sk-ant-...";
  }
}

export async function bonReportsOpenSettings(): Promise<void> {
  apiKeyInput.value = "";
  apiKeyStatus.textContent = "Loading...";
  apiKeyStatus.className = "bon-settings-status";
  settingsModal.hidden = false;
  apiKeyInput.focus();
  try {
    const { hasKey } = (await browser.runtime.sendMessage({
      type: "get-claude-api-key",
    })) as { hasKey: boolean };
    renderApiKeyStatus(hasKey);
  } catch {
    apiKeyStatus.textContent = "Failed to read key status.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  }
}

async function saveApiKey(): Promise<void> {
  const value = apiKeyInput.value.trim();
  if (!value) {
    settingsModal.hidden = true;
    return;
  }
  settingsSave.disabled = true;
  try {
    const { hasKey } = (await browser.runtime.sendMessage({
      type: "set-claude-api-key",
      apiKey: value,
    })) as { hasKey: boolean };
    renderApiKeyStatus(hasKey);
    apiKeyInput.value = "";
    settingsModal.hidden = true;
  } catch {
    apiKeyStatus.textContent = "Failed to save key.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  } finally {
    settingsSave.disabled = false;
  }
}

export function bonReportsInitSettingsModal(): void {
  settingsBtn.addEventListener("click", bonReportsOpenSettings);
  settingsCancel.addEventListener("click", () => {
    settingsModal.hidden = true;
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal.hidden = true;
    }
  });
  settingsSave.addEventListener("click", saveApiKey);
}

export function bonReportsCloseModalsOnEscape(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") {
      return;
    }
    if (!modal.hidden) {
      closeConfirmModal();
    }
    if (!settingsModal.hidden) {
      settingsModal.hidden = true;
    }
  });
}
