// Settings tab: Claude API key + danger-zone clear-all. Lives as a
// regular tab panel rather than a modal; activating the tab uses the
// shared tab handler, so this module only owns the inputs and buttons.

import { bonClientSend } from "../../client.ts";
import {
  bonGoogleHarvestIsGranted,
  bonGoogleHarvestMatches,
  bonGoogleHarvestRequest,
  bonGoogleHarvestRevoke,
} from "../google-harvest/permission.ts";
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
const googlePermissionStatus = document.getElementById(
  "bon-google-permission-status"
) as HTMLElement;
const googlePermissionToggle = document.getElementById(
  "bon-google-permission-toggle"
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
    const { hasKey } = await bonClientSend<{ hasKey: boolean }>({
      type: "get-claude-api-key",
    });
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
    const { hasKey } = await bonClientSend<{ hasKey: boolean }>({
      type: "set-claude-api-key",
      apiKey: value,
    });
    renderApiKeyStatus(hasKey);
    apiKeyInput.value = "";
  } catch {
    apiKeyStatus.textContent = "Failed to save key.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  } finally {
    settingsSave.disabled = false;
  }
}

function renderGooglePermissionState(granted: boolean): void {
  googlePermissionToggle.hidden = false;

  if (granted) {
    googlePermissionStatus.textContent = "Enabled.";
    googlePermissionStatus.className =
      "bon-settings-toggle-status bon-settings-toggle-status--on";
    googlePermissionToggle.textContent = "Disable";
    googlePermissionToggle.className = "bon-btn";
  } else {
    googlePermissionStatus.textContent = "Disabled.";
    googlePermissionStatus.className = "bon-settings-toggle-status";
    googlePermissionToggle.textContent = "Enable";
    googlePermissionToggle.className = "bon-btn";
  }
}

async function refreshGooglePermissionState(): Promise<void> {
  try {
    const granted = await bonGoogleHarvestIsGranted();
    renderGooglePermissionState(granted);
  } catch {
    googlePermissionStatus.textContent = "Failed to read permission state.";
    googlePermissionToggle.hidden = true;
  }
}

// browser.permissions.request must be called synchronously from the click
// handler's microtask chain or Firefox treats it as missing a user gesture
// and silently rejects the prompt. Awaiting the current state first would
// break that, so we read it from the button label instead — render*State
// keeps it in sync with the real state.
async function toggleGooglePermission(): Promise<void> {
  googlePermissionToggle.disabled = true;

  try {
    const currentlyEnabled = googlePermissionToggle.textContent === "Disable";

    if (currentlyEnabled) {
      await bonGoogleHarvestRevoke();
    } else {
      await bonGoogleHarvestRequest();
    }

    await refreshGooglePermissionState();
  } finally {
    googlePermissionToggle.disabled = false;
  }
}

export function bonReportsInitSettings(): void {
  apiKeyStatus.textContent = "Loading...";
  apiKeyStatus.className = "bon-settings-status";
  void bonReportsRefreshApiKeyStatus();
  void refreshGooglePermissionState();

  settingsSave.addEventListener("click", saveApiKey);

  apiKeyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveApiKey();
    }
  });

  googlePermissionToggle.addEventListener("click", () => {
    void toggleGooglePermission();
  });

  // about:addons lets users revoke optional permissions out-of-band; mirror
  // that change into the UI so the toggle label doesn't lie.
  browser.permissions.onAdded.addListener((permissions) => {
    if (bonGoogleHarvestMatches(permissions)) {
      renderGooglePermissionState(true);
    }
  });

  browser.permissions.onRemoved.addListener((permissions) => {
    if (bonGoogleHarvestMatches(permissions)) {
      renderGooglePermissionState(false);
    }
  });

  clearAllBtn.addEventListener("click", () => {
    bonReportsOpenConfirmModal({
      text: "Clear all reported users and your saved API key? This can't be undone.",
      confirmLabel: "Clear all",
      action: async () => {
        await bonClientSend({ type: "clear-all-reports" });
        await bonClientSend({ type: "set-claude-api-key", apiKey: "" });
        await bonReportsRefreshApiKeyStatus();
      },
    });
  });
}
