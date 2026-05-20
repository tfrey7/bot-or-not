// Sync section — manual export/import of browser.storage.local. Rendered
// inside the Settings tab; the surrounding section provides the heading and
// description, so this module only emits the export + import action blocks.
// Reports + an optional Claude API key serialize to a JSON file the user can
// carry between machines; import merges the file back in per-username.

import {
  BON_SYNC_BACKUP_VERSION,
  bonSyncBackupFilename,
  bonSyncParseBackup,
  type MergeStats,
  type ParseResult,
  type SyncBackupPayload,
} from "./logic.ts";

export function bonRenderSync(container: HTMLElement | null): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const wrapper = document.createElement("div");
  wrapper.className = "bon-sync";
  wrapper.appendChild(buildExportBlock());
  wrapper.appendChild(buildImportBlock());

  container.appendChild(wrapper);
}

function buildExportBlock(): HTMLElement {
  const block = document.createElement("div");
  block.className = "bon-sync-block";

  const title = document.createElement("h3");
  title.className = "bon-sync-block-title";
  title.textContent = "Export";
  block.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "bon-sync-block-desc";
  desc.textContent =
    "Downloads a JSON file containing every reported user and investigation. The Claude API key is never included.";
  block.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "bon-sync-actions";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "bon-btn";
  exportButton.textContent = "Download backup";

  const status = document.createElement("p");
  status.className = "bon-sync-status";

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    status.textContent = "Building backup…";
    status.className = "bon-sync-status";

    try {
      const response = (await browser.runtime.sendMessage({
        type: "sync-export",
      })) as { payload: SyncBackupPayload };

      const blob = new Blob([JSON.stringify(response.payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = bonSyncBackupFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const userCount = Object.keys(response.payload.reports).length;
      const sizeKb = (blob.size / 1024).toFixed(1);
      status.textContent = `Downloaded backup: ${userCount} user${userCount === 1 ? "" : "s"} · ${sizeKb} KB`;
      status.className = "bon-sync-status bon-sync-status--ok";
    } catch (error) {
      console.error("[Bot or Not] export failed", error);
      status.textContent = `Export failed: ${(error as Error).message}`;
      status.className = "bon-sync-status bon-sync-status--error";
    } finally {
      exportButton.disabled = false;
    }
  });

  actions.appendChild(exportButton);
  block.appendChild(actions);
  block.appendChild(status);

  return block;
}

function buildImportBlock(): HTMLElement {
  const block = document.createElement("div");
  block.className = "bon-sync-block";

  const title = document.createElement("h3");
  title.className = "bon-sync-block-title";
  title.textContent = "Import";
  block.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "bon-sync-block-desc";
  desc.textContent = `Backup format v${BON_SYNC_BACKUP_VERSION}. Per-user merge: histories combine and the newer investigation wins.`;
  block.appendChild(desc);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.id = "bon-sync-import-file";
  fileInput.className = "bon-sync-file-input";

  const fileLabel = document.createElement("label");
  fileLabel.htmlFor = "bon-sync-import-file";
  fileLabel.className = "bon-btn";
  fileLabel.textContent = "Choose file…";

  const status = document.createElement("p");
  status.className = "bon-sync-status";

  const preview = document.createElement("div");
  preview.className = "bon-sync-preview";
  preview.hidden = true;

  const actions = document.createElement("div");
  actions.className = "bon-sync-actions";
  actions.appendChild(fileLabel);
  actions.appendChild(fileInput);

  block.appendChild(actions);
  block.appendChild(preview);
  block.appendChild(status);

  let parsedPayload: SyncBackupPayload | null = null;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }

    parsedPayload = null;
    preview.hidden = true;
    preview.replaceChildren();
    status.textContent = `Reading ${file.name}…`;
    status.className = "bon-sync-status";

    const text = await file.text();
    const result: ParseResult = bonSyncParseBackup(text);

    if (!result.ok) {
      status.textContent = result.error;
      status.className = "bon-sync-status bon-sync-status--error";
      return;
    }

    parsedPayload = result.payload;
    renderImportPreview(preview, file.name, result.payload, async () => {
      await runImport(parsedPayload, status, preview, fileInput);
      parsedPayload = null;
    });
    preview.hidden = false;
    status.textContent = "";
  });

  return block;
}

function renderImportPreview(
  container: HTMLElement,
  fileName: string,
  payload: SyncBackupPayload,
  onConfirm: () => Promise<void>
): void {
  container.replaceChildren();

  const summary = document.createElement("dl");
  summary.className = "bon-sync-preview-summary";

  addPreviewRow(summary, "File", fileName);
  addPreviewRow(summary, "Backup version", `v${payload.bonBackup}`);
  addPreviewRow(summary, "From app version", payload.appVersion);
  if (payload.exportedAt) {
    addPreviewRow(
      summary,
      "Exported",
      new Date(payload.exportedAt).toLocaleString()
    );
  }

  addPreviewRow(
    summary,
    "Users in backup",
    String(Object.keys(payload.reports).length)
  );

  container.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "bon-sync-actions";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "bon-btn";
  confirmButton.textContent = "Merge into my data";

  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    confirmButton.textContent = "Merging…";
    try {
      await onConfirm();
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = "Merge into my data";
    }
  });

  actions.appendChild(confirmButton);
  container.appendChild(actions);
}

function addPreviewRow(
  parent: HTMLElement,
  label: string,
  value: string
): void {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  parent.appendChild(dt);
  parent.appendChild(dd);
}

async function runImport(
  payload: SyncBackupPayload | null,
  status: HTMLElement,
  preview: HTMLElement,
  fileInput: HTMLInputElement
): Promise<void> {
  if (!payload) {
    return;
  }

  status.textContent = "Merging…";
  status.className = "bon-sync-status";

  try {
    const response = (await browser.runtime.sendMessage({
      type: "sync-import",
      reports: payload.reports,
    })) as { ok: true; stats: MergeStats };

    const { added, merged, unchanged } = response.stats;
    status.textContent = formatImportResult(added, merged, unchanged);
    status.className = "bon-sync-status bon-sync-status--ok";
    preview.hidden = true;
    preview.replaceChildren();
    fileInput.value = "";
  } catch (error) {
    console.error("[Bot or Not] import failed", error);
    status.textContent = `Import failed: ${(error as Error).message}`;
    status.className = "bon-sync-status bon-sync-status--error";
  }
}

function formatImportResult(
  added: string[],
  merged: string[],
  unchanged: string[]
): string {
  const parts: string[] = [];
  parts.push(`${added.length} added`);
  parts.push(`${merged.length} merged`);
  if (unchanged.length > 0) {
    parts.push(`${unchanged.length} unchanged`);
  }

  return `Imported · ${parts.join(" · ")}`;
}
