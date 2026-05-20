// Settings tab: Claude API key + danger-zone clear-all. Lives as a
// regular tab panel rather than a modal; activating the tab uses the
// shared tab handler, so this module only owns the inputs and buttons.

import { bonReportsOpenConfirmModal } from "./confirm_modal.ts";

const settingsTab = document.getElementById(
  "bon-tab-settings"
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
const clearAllBtn = document.getElementById(
  "bon-clear-btn"
) as HTMLButtonElement;

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

export async function bonReportsRefreshApiKeyStatus(): Promise<void> {
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

export function bonReportsOpenSettings(): void {
  settingsTab.click();
  apiKeyInput.focus();
}

async function saveApiKey(): Promise<void> {
  const value = apiKeyInput.value.trim();

  if (!value) {
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
  } catch {
    apiKeyStatus.textContent = "Failed to save key.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  } finally {
    settingsSave.disabled = false;
  }
}

export function bonReportsInitSettings(): void {
  apiKeyStatus.textContent = "Loading...";
  apiKeyStatus.className = "bon-settings-status";
  void bonReportsRefreshApiKeyStatus();

  settingsSave.addEventListener("click", saveApiKey);

  apiKeyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveApiKey();
    }
  });

  clearAllBtn.addEventListener("click", () => {
    bonReportsOpenConfirmModal({
      text: "Clear all reported users? This can't be undone.",
      confirmLabel: "Clear all",
      action: () => browser.runtime.sendMessage({ type: "clear-all-reports" }),
    });
  });
}
