// Settings tab: LLM vendor/model pickers, API key, Google harvest
// permission, sync, danger-zone clear-all. Lives as a regular tab panel
// rather than a modal; activating the tab uses the shared tab handler,
// so this module only owns the inputs and buttons.

import { clientSend } from "../../client.ts";
import type { LlmVendor } from "../../llm/index.ts";
import {
  googleHarvestIsGranted,
  googleHarvestMatches,
  googleHarvestRequest,
  googleHarvestRevoke,
} from "../google-harvest";
import { pageOpenConfirmModal } from "../page";
export { settingsStrip } from "./strip.tsx";

// DOM refs deferred to settingsInit so this module is safe to import
// from any context (the boundary lint rule forces redditors/index.ts to
// barrel-re-export ./page.ts, which transitively pulls this module into
// the background bundle even though the UI never runs there).
let settingsTab!: HTMLButtonElement;
let settingsSave!: HTMLButtonElement;
let apiKeyInput!: HTMLInputElement;
let apiKeyStatus!: HTMLElement;
let clearAllBtn!: HTMLButtonElement;
let googlePermissionStatus!: HTMLElement;
let googlePermissionToggle!: HTMLButtonElement;
let llmVendorSelect!: HTMLSelectElement;
let llmModelSelect!: HTMLSelectElement;
let hidePiiStatus!: HTMLElement;
let hidePiiToggle!: HTMLButtonElement;
let maintenanceStatus!: HTMLElement;
let maintenanceToggle!: HTMLButtonElement;

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
    llmSelectionState = await clientSend<LlmSelectionPayload>({
      type: "get-llm-selection",
    });
    renderLlmSelection();
  } catch {
    apiKeyStatus.textContent = "Failed to load LLM settings.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  }
}

export async function settingsRefreshApiKeyStatus(): Promise<void> {
  try {
    apiKeysState = await clientSend<ApiKeysPayload>({
      type: "get-api-keys",
    });
    renderApiKeyStatus();
  } catch {
    apiKeyStatus.textContent = "Failed to read key status.";
    apiKeyStatus.className = "bon-settings-status bon-settings-status--missing";
  }
}

export function settingsOpen(): void {
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
      const result = await clientSend<{
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

    await clientSend({
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
    const { hidePii } = await clientSend<{ hidePii: boolean }>({
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
    await clientSend({ type: "set-hide-pii", value: next });
    renderHidePiiState(next);
  } finally {
    hidePiiToggle.disabled = false;
  }
}

function renderMaintenanceState(paused: boolean): void {
  maintenanceToggle.hidden = false;

  if (paused) {
    maintenanceStatus.textContent = "Paused.";
    maintenanceStatus.className = "bon-settings-toggle-status";
    maintenanceToggle.textContent = "Resume";
  } else {
    maintenanceStatus.textContent = "Running.";
    maintenanceStatus.className =
      "bon-settings-toggle-status bon-settings-toggle-status--on";
    maintenanceToggle.textContent = "Pause";
  }
}

async function refreshMaintenanceState(): Promise<void> {
  try {
    const { paused } = await clientSend<{ paused: boolean }>({
      type: "get-maintenance-paused",
    });
    renderMaintenanceState(!!paused);
  } catch {
    maintenanceStatus.textContent = "Failed to read maintenance state.";
    maintenanceToggle.hidden = true;
  }
}

async function toggleMaintenance(): Promise<void> {
  maintenanceToggle.disabled = true;

  try {
    const next = maintenanceToggle.textContent !== "Resume";
    await clientSend({ type: "set-maintenance-paused", value: next });
    renderMaintenanceState(next);
  } finally {
    maintenanceToggle.disabled = false;
  }
}

async function refreshGooglePermissionState(): Promise<void> {
  try {
    const granted = await googleHarvestIsGranted();
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
      await googleHarvestRevoke();
    } else {
      await googleHarvestRequest();
    }

    await refreshGooglePermissionState();
  } finally {
    googlePermissionToggle.disabled = false;
  }
}

export function settingsInit(): void {
  settingsTab = document.getElementById(
    "bon-tab-settings"
  ) as HTMLButtonElement;
  settingsSave = document.getElementById(
    "bon-settings-save"
  ) as HTMLButtonElement;
  apiKeyInput = document.getElementById(
    "bon-api-key-input"
  ) as HTMLInputElement;
  apiKeyStatus = document.getElementById("bon-api-key-status") as HTMLElement;
  clearAllBtn = document.getElementById("bon-clear-btn") as HTMLButtonElement;
  googlePermissionStatus = document.getElementById(
    "bon-google-permission-status"
  ) as HTMLElement;
  googlePermissionToggle = document.getElementById(
    "bon-google-permission-toggle"
  ) as HTMLButtonElement;
  llmVendorSelect = document.getElementById(
    "bon-llm-vendor-select"
  ) as HTMLSelectElement;
  llmModelSelect = document.getElementById(
    "bon-llm-model-select"
  ) as HTMLSelectElement;
  hidePiiStatus = document.getElementById("bon-hide-pii-status") as HTMLElement;
  hidePiiToggle = document.getElementById(
    "bon-hide-pii-toggle"
  ) as HTMLButtonElement;
  maintenanceStatus = document.getElementById(
    "bon-maintenance-status"
  ) as HTMLElement;
  maintenanceToggle = document.getElementById(
    "bon-maintenance-toggle"
  ) as HTMLButtonElement;

  apiKeyStatus.textContent = "Loading...";
  apiKeyStatus.className = "bon-settings-status";

  void loadLlmSelection().then(() => settingsRefreshApiKeyStatus());
  void refreshGooglePermissionState();
  void refreshHidePiiState();
  void refreshMaintenanceState();

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

  maintenanceToggle.addEventListener("click", () => {
    void toggleMaintenance();
  });

  // about:addons lets users revoke optional permissions out-of-band; mirror
  // that change into the UI so the toggle label doesn't lie.
  browser.permissions.onAdded.addListener((permissions) => {
    if (googleHarvestMatches(permissions)) {
      renderGooglePermissionState(true);
    }
  });

  browser.permissions.onRemoved.addListener((permissions) => {
    if (googleHarvestMatches(permissions)) {
      renderGooglePermissionState(false);
    }
  });

  clearAllBtn.addEventListener("click", () => {
    pageOpenConfirmModal({
      text: "Clear all reported users and your saved API keys? This can't be undone.",
      confirmLabel: "Clear all",
      action: async () => {
        await clientSend({ type: "clear-all-reports" });
        await clientSend({ type: "clear-api-keys" });
        await settingsRefreshApiKeyStatus();
      },
    });
  });
}
