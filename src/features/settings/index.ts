// Settings tab: LLM vendor/model pickers, API key, Google harvest
// permission, sync, danger-zone clear-all. Lives as a regular tab panel
// rather than a modal; activating the tab uses the shared tab handler,
// so this module only owns the inputs and buttons.

import { bonClientSend } from "../../client.ts";
import type { LlmVendor } from "../../llm/index.ts";
import {
  bonGoogleHarvestIsGranted,
  bonGoogleHarvestMatches,
  bonGoogleHarvestRequest,
  bonGoogleHarvestRevoke,
} from "../google-harvest/permission.ts";
import { bonPageOpenConfirmModal } from "../page";
export { bonSettingsStrip } from "./strip.ts";

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
const llmVendorSelect = document.getElementById(
  "bon-llm-vendor-select"
) as HTMLSelectElement;
const llmModelSelect = document.getElementById(
  "bon-llm-model-select"
) as HTMLSelectElement;
const hidePiiStatus = document.getElementById(
  "bon-hide-pii-status"
) as HTMLElement;
const hidePiiToggle = document.getElementById(
  "bon-hide-pii-toggle"
) as HTMLButtonElement;

interface LlmSelectionPayload {
  vendor: LlmVendor | null;
  model: string | null;
  vendors: Array<{ id: LlmVendor; label: string }>;
  modelsByVendor: Record<
    LlmVendor,
    { defaultModel: string; models: Array<{ id: string; label: string }> }
  >;
}

interface ApiKeysPayload {
  hasKey: Record<LlmVendor, boolean>;
}

let llmSelectionState: LlmSelectionPayload | null = null;
let apiKeysState: ApiKeysPayload | null = null;

function renderApiKeyStatus(): void {
  const vendor = effectiveVendor();
  const placeholder = vendor === "openai" ? "sk-..." : "sk-ant-...";
  const vendorLabel =
    llmSelectionState?.vendors.find((v) => v.id === vendor)?.label ?? vendor;
  const hasKey = !!apiKeysState?.hasKey[vendor];

  if (hasKey) {
    apiKeyStatus.textContent = `${vendorLabel} key set. Type a new one to replace, or leave blank to keep.`;
    apiKeyStatus.className = "bon-settings-status bon-settings-status--set";
    apiKeyInput.placeholder = "•••• (key on file)";
  } else {
    apiKeyStatus.textContent = `No ${vendorLabel} key on file. Investigations will fail until one is saved.`;
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
    apiKeyInput.placeholder = placeholder;
  }
}

function effectiveVendor(): LlmVendor {
  return (
    llmSelectionState?.vendor ??
    llmSelectionState?.vendors[0]?.id ??
    "anthropic"
  );
}

function renderLlmSelection(): void {
  if (!llmSelectionState) {
    return;
  }

  const { vendor, model, vendors, modelsByVendor } = llmSelectionState;
  const activeVendor = vendor ?? vendors[0]?.id ?? "anthropic";

  llmVendorSelect.innerHTML = "";

  for (const v of vendors) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.label;
    if (v.id === activeVendor) {
      opt.selected = true;
    }

    llmVendorSelect.appendChild(opt);
  }

  const vendorEntry = modelsByVendor[activeVendor];
  llmModelSelect.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = `Default (${vendorEntry?.defaultModel ?? "—"})`;
  llmModelSelect.appendChild(defaultOpt);

  for (const m of vendorEntry?.models ?? []) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === model) {
      opt.selected = true;
    }

    llmModelSelect.appendChild(opt);
  }

  if (!model) {
    defaultOpt.selected = true;
  }
}

async function loadLlmSelection(): Promise<void> {
  try {
    llmSelectionState = await bonClientSend<LlmSelectionPayload>({
      type: "get-llm-selection",
    });
    renderLlmSelection();
  } catch {
    apiKeyStatus.textContent = "Failed to load LLM settings.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  }
}

export async function bonSettingsRefreshApiKeyStatus(): Promise<void> {
  try {
    apiKeysState = await bonClientSend<ApiKeysPayload>({
      type: "get-api-keys",
    });
    renderApiKeyStatus();
  } catch {
    apiKeyStatus.textContent = "Failed to read key status.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  }
}

export function bonSettingsOpen(): void {
  settingsTab.click();
  apiKeyInput.focus();
}

// One Save button for the whole section: writes the current vendor + model
// selection AND the API key field (if the user typed one). Vendor + model
// dropdowns mutate local state only until Save is clicked.
//
// If the typed key's prefix doesn't match the selected vendor, the
// backend sniffs the true vendor and tells us — we switch the dropdown
// over and persist the selection so the configuration ends up internally
// consistent. (Pasting an Anthropic key with OpenAI in the dropdown is
// almost always a vendor-switch intent, not a mis-pasted key.)
async function saveSettings(): Promise<void> {
  if (!llmSelectionState) {
    return;
  }

  let vendor = llmVendorSelect.value as LlmVendor;
  let model = llmModelSelect.value || null;
  const keyValue = apiKeyInput.value.trim();

  settingsSave.disabled = true;

  try {
    if (keyValue) {
      const result = await bonClientSend<{
        ok: true;
        vendor: LlmVendor;
        hasKey: Record<LlmVendor, boolean>;
      }>({
        type: "set-api-key",
        apiKey: keyValue,
        vendor,
      });

      apiKeysState = { hasKey: result.hasKey };
      apiKeyInput.value = "";

      // Key prefix wins over dropdown selection. If they diverged, the
      // dropdown follows the key.
      if (result.vendor !== vendor) {
        vendor = result.vendor;
        model = null;
        llmSelectionState = {
          ...llmSelectionState,
          vendor,
          model,
        };
        renderLlmSelection();
      }
    }

    await bonClientSend({
      type: "set-llm-selection",
      vendor,
      model,
    });
    llmSelectionState = {
      ...llmSelectionState,
      vendor,
      model,
    };

    renderApiKeyStatus();
  } catch {
    apiKeyStatus.textContent = "Failed to save.";
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

function renderHidePiiState(enabled: boolean): void {
  hidePiiToggle.hidden = false;

  if (enabled) {
    hidePiiStatus.textContent = "Enabled.";
    hidePiiStatus.className =
      "bon-settings-toggle-status bon-settings-toggle-status--on";
    hidePiiToggle.textContent = "Disable";
  } else {
    hidePiiStatus.textContent = "Disabled.";
    hidePiiStatus.className = "bon-settings-toggle-status";
    hidePiiToggle.textContent = "Enable";
  }
}

async function refreshHidePiiState(): Promise<void> {
  try {
    const { hidePii } = await bonClientSend<{ hidePii: boolean }>({
      type: "get-hide-pii",
    });
    renderHidePiiState(!!hidePii);
  } catch {
    hidePiiStatus.textContent = "Failed to read privacy state.";
    hidePiiToggle.hidden = true;
  }
}

async function toggleHidePii(): Promise<void> {
  hidePiiToggle.disabled = true;

  try {
    const next = hidePiiToggle.textContent !== "Disable";
    await bonClientSend({ type: "set-hide-pii", value: next });
    renderHidePiiState(next);
  } finally {
    hidePiiToggle.disabled = false;
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

export function bonSettingsInit(): void {
  apiKeyStatus.textContent = "Loading...";
  apiKeyStatus.className = "bon-settings-status";

  void loadLlmSelection().then(() => bonSettingsRefreshApiKeyStatus());
  void refreshGooglePermissionState();
  void refreshHidePiiState();

  llmVendorSelect.addEventListener("change", () => {
    // Switching vendor invalidates the current model choice — re-render
    // the model list against the new vendor's options and clear the
    // explicit pick (back to "Default"). State stays local until Save.
    if (!llmSelectionState) {
      return;
    }

    llmSelectionState = {
      ...llmSelectionState,
      vendor: llmVendorSelect.value as LlmVendor,
      model: null,
    };
    renderLlmSelection();

    // Refresh the API-key status so the operator sees whether the new
    // vendor already has a key on file, before they hit Save.
    renderApiKeyStatus();
  });

  settingsSave.addEventListener("click", saveSettings);

  apiKeyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveSettings();
    }
  });

  googlePermissionToggle.addEventListener("click", () => {
    void toggleGooglePermission();
  });

  hidePiiToggle.addEventListener("click", () => {
    void toggleHidePii();
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
    bonPageOpenConfirmModal({
      text: "Clear all reported users and your saved API keys? This can't be undone.",
      confirmLabel: "Clear all",
      action: async () => {
        await bonClientSend({ type: "clear-all-reports" });
        await bonClientSend({ type: "clear-api-keys" });
        await bonSettingsRefreshApiKeyStatus();
      },
    });
  });
}
