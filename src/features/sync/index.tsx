// Sync section — automatic gist sync plus manual export/import of
// browser.storage.local. Rendered inside the Settings tab; the surrounding
// section provides the heading and description. Reports + an optional API
// key serialize to a JSON file the user can carry between machines; import
// merges the file back in per-username.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { clientSend } from "../../client.ts";
import {
  SYNC_BACKUP_VERSION,
  syncBackupFilename,
  syncParseBackup,
  type MergeStats,
  type ParseResult,
  type SyncBackupPayload,
  type SyncStatusPayload,
} from "./logic.ts";
import { githubSyncRequest } from "./permission.ts";

export function renderSync(container: HTMLElement | null): void {
  if (!container) {
    return;
  }

  render(<SyncPanel />, container);
}

function SyncPanel() {
  return (
    <div class="bon-sync">
      <AutoSyncBlock />
      <ExportBlock />
      <ImportBlock />
    </div>
  );
}

// Transient status line: pending text, validation nudges, action errors.
// Cleared whenever a fresh SyncStatusPayload lands.
interface StatusNote {
  text: string;
  tone: "plain" | "ok" | "error";
}

function statusClass(tone: StatusNote["tone"]): string {
  if (tone === "ok") {
    return "bon-sync-status bon-sync-status--ok";
  }

  if (tone === "error") {
    return "bon-sync-status bon-sync-status--error";
  }

  return "bon-sync-status";
}

function AutoSyncBlock() {
  const tokenRef = useRef<HTMLInputElement>(null);
  const gistRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SyncStatusPayload | null>(null);
  const [note, setNote] = useState<StatusNote | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const fresh = await clientSend<SyncStatusPayload>({
        type: "sync-status",
      });
      setState(fresh);
    })();
  }, []);

  // Pre-fill the gist ID from the stored config, but never stomp on
  // something the operator has typed.
  useEffect(() => {
    if (state?.gistId && gistRef.current && !gistRef.current.value) {
      gistRef.current.value = state.gistId;
    }
  }, [state]);

  const runAction = async (
    pending: string,
    action: () => Promise<SyncStatusPayload>
  ): Promise<void> => {
    setBusy(true);
    setNote({ text: pending, tone: "plain" });

    try {
      setState(await action());
      setNote(null);
    } catch (error) {
      console.error("[Bot or Not] sync action failed", error);
      setNote({ text: (error as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (): Promise<void> => {
    const token = tokenRef.current?.value.trim() ?? "";

    if (!token) {
      setNote({ text: "Enter a GitHub token first.", tone: "error" });
      return;
    }

    if (!(await githubSyncRequest())) {
      setNote({ text: "GitHub access permission was denied.", tone: "error" });
      return;
    }

    await runAction("Creating gist…", () =>
      clientSend<SyncStatusPayload>({ type: "sync-create-gist", token })
    );
  };

  const handleUse = async (): Promise<void> => {
    const token = tokenRef.current?.value.trim() ?? "";
    const gistId = gistRef.current?.value.trim() ?? "";

    if (!token || !gistId) {
      setNote({ text: "Enter both a token and a gist ID.", tone: "error" });
      return;
    }

    if (!(await githubSyncRequest())) {
      setNote({ text: "GitHub access permission was denied.", tone: "error" });
      return;
    }

    await runAction("Enabling sync…", () =>
      clientSend<SyncStatusPayload>({
        type: "sync-configure",
        token,
        gistId,
        enabled: true,
      })
    );
  };

  const status = note ?? describeSyncState(state);

  return (
    <div class="bon-sync-block">
      <h3 class="bon-sync-block-title">Automatic sync</h3>
      <p class="bon-sync-block-desc">
        Keep two browsers in step through a private GitHub gist. Needs a
        fine-grained token with gist read/write. On the first machine, create a
        new gist; on the second, paste that gist ID and the same token. The
        token stays on this device — only your reports travel through the gist.
      </p>
      <div class="bon-sync-fields">
        <label class="bon-sync-field">
          <span class="bon-sync-field-label">Token</span>
          <input
            ref={tokenRef}
            type="password"
            class="bon-sync-input"
            autocomplete="off"
            placeholder={
              state?.hasToken
                ? "•••• (token on file — re-enter to change)"
                : "GitHub token (github_pat_… or ghp_…)"
            }
          />
        </label>
        <label class="bon-sync-field">
          <span class="bon-sync-field-label">Gist ID</span>
          <input
            ref={gistRef}
            type="text"
            class="bon-sync-input"
            autocomplete="off"
            spellcheck={false}
            placeholder="Gist ID (paste on the second machine)"
          />
        </label>
      </div>
      <div class="bon-sync-actions">
        <button
          type="button"
          class="bon-btn"
          disabled={busy}
          onClick={() => void handleCreate()}
        >
          Create gist &amp; enable
        </button>
        <button
          type="button"
          class="bon-btn"
          disabled={busy}
          onClick={() => void handleUse()}
        >
          Use gist &amp; enable
        </button>
      </div>
      <div class="bon-sync-actions" hidden={!state?.enabled}>
        <button
          type="button"
          class="bon-btn"
          disabled={busy}
          onClick={() =>
            void runAction("Syncing…", () =>
              clientSend<SyncStatusPayload>({ type: "sync-now" })
            )
          }
        >
          Sync now
        </button>
        <button
          type="button"
          class="bon-btn"
          disabled={busy}
          onClick={() =>
            void runAction("Turning off…", () =>
              clientSend<SyncStatusPayload>({ type: "sync-disable" })
            )
          }
        >
          Turn off
        </button>
      </div>
      <p class={statusClass(status.tone)}>{status.text}</p>
    </div>
  );
}

function describeSyncState(state: SyncStatusPayload | null): StatusNote {
  if (!state) {
    return { text: "", tone: "plain" };
  }

  if (state.lastError) {
    return { text: `Last sync failed: ${state.lastError}`, tone: "error" };
  }

  if (!state.enabled) {
    return { text: "Off.", tone: "plain" };
  }

  const when = state.lastSyncedAt
    ? new Date(state.lastSyncedAt).toLocaleString()
    : "not yet";

  return {
    text: `On · syncing to gist ${state.gistId ?? "?"} · last synced ${when}`,
    tone: "ok",
  };
}

function ExportBlock() {
  const [note, setNote] = useState<StatusNote>({ text: "", tone: "plain" });
  const [busyButton, setBusyButton] = useState<"download" | "copy" | null>(
    null
  );

  const fetchBackup = async (): Promise<SyncBackupPayload> => {
    const response = await clientSend<{ payload: SyncBackupPayload }>({
      type: "sync-export",
    });

    return response.payload;
  };

  const handleDownload = async (): Promise<void> => {
    setBusyButton("download");
    setNote({ text: "Building backup…", tone: "plain" });

    try {
      const payload = await fetchBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = syncBackupFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const userCount = Object.keys(payload.reports).length;
      const sizeKb = (blob.size / 1024).toFixed(1);
      setNote({
        text: `Downloaded backup: ${userCount} user${userCount === 1 ? "" : "s"} · ${sizeKb} KB`,
        tone: "ok",
      });
    } catch (error) {
      console.error("[Bot or Not] export failed", error);
      setNote({
        text: `Export failed: ${(error as Error).message}`,
        tone: "error",
      });
    } finally {
      setBusyButton(null);
    }
  };

  const handleCopy = async (): Promise<void> => {
    setBusyButton("copy");
    setNote({ text: "Building backup…", tone: "plain" });

    try {
      const payload = await fetchBackup();
      const text = JSON.stringify(payload, null, 2);
      await navigator.clipboard.writeText(text);

      const userCount = Object.keys(payload.reports).length;
      const sizeKb = (new Blob([text]).size / 1024).toFixed(1);
      setNote({
        text: `Copied backup: ${userCount} user${userCount === 1 ? "" : "s"} · ${sizeKb} KB`,
        tone: "ok",
      });
    } catch (error) {
      console.error("[Bot or Not] copy to clipboard failed", error);
      setNote({
        text: `Copy failed: ${(error as Error).message}`,
        tone: "error",
      });
    } finally {
      setBusyButton(null);
    }
  };

  return (
    <div class="bon-sync-block">
      <h3 class="bon-sync-block-title">Export</h3>
      <p class="bon-sync-block-desc">
        Download a JSON file or copy the same payload to the clipboard. Every
        reported user and investigation is included; the Claude API key is not.
      </p>
      <div class="bon-sync-actions">
        <button
          type="button"
          class="bon-btn"
          disabled={busyButton === "download"}
          onClick={() => void handleDownload()}
        >
          Download backup
        </button>
        <button
          type="button"
          class="bon-btn"
          disabled={busyButton === "copy"}
          onClick={() => void handleCopy()}
        >
          Copy to clipboard
        </button>
      </div>
      <p class={statusClass(note.tone)}>{note.text}</p>
    </div>
  );
}

interface ParsedImport {
  payload: SyncBackupPayload;
  sourceLabel: string;
}

function ImportBlock() {
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [note, setNote] = useState<StatusNote>({ text: "", tone: "plain" });
  const [merging, setMerging] = useState(false);

  const tryParseText = (text: string, sourceLabel: string): void => {
    const trimmed = text.trim();

    if (!trimmed) {
      setParsed(null);
      setNote({ text: "", tone: "plain" });
      return;
    }

    const result: ParseResult = syncParseBackup(trimmed);

    if (!result.ok) {
      setParsed(null);
      setNote({ text: result.error, tone: "error" });
      return;
    }

    setParsed({ payload: result.payload, sourceLabel });
    setNote({ text: "", tone: "plain" });
  };

  const handleFileChange = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];

    if (!file) {
      return;
    }

    if (textareaRef.current) {
      textareaRef.current.value = "";
    }

    setParsed(null);
    setNote({ text: `Reading ${file.name}…`, tone: "plain" });

    const text = await file.text();
    tryParseText(text, file.name);
  };

  const handlePaste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();

      if (textareaRef.current) {
        textareaRef.current.value = text;
      }

      if (fileRef.current) {
        fileRef.current.value = "";
      }

      tryParseText(text, "Clipboard");
    } catch (error) {
      console.error("[Bot or Not] paste from clipboard failed", error);
      setNote({
        text: `Paste failed: ${(error as Error).message}. Paste into the textarea manually.`,
        tone: "error",
      });
    }
  };

  const handleMerge = async (): Promise<void> => {
    if (!parsed) {
      return;
    }

    setMerging(true);
    setNote({ text: "Merging…", tone: "plain" });

    try {
      const response = await clientSend<{ ok: true; stats: MergeStats }>({
        type: "sync-import",
        reports: parsed.payload.reports,
      });

      const { added, merged, unchanged } = response.stats;
      setNote({
        text: formatImportResult(added, merged, unchanged),
        tone: "ok",
      });
      setParsed(null);

      if (fileRef.current) {
        fileRef.current.value = "";
      }

      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    } catch (error) {
      console.error("[Bot or Not] import failed", error);
      setNote({
        text: `Import failed: ${(error as Error).message}`,
        tone: "error",
      });
    } finally {
      setMerging(false);
    }
  };

  return (
    <div class="bon-sync-block">
      <h3 class="bon-sync-block-title">Import</h3>
      <p class="bon-sync-block-desc">
        Backup format v{SYNC_BACKUP_VERSION}. Pick a file or paste a backup
        payload directly. Per-user merge: histories combine and the newer
        investigation wins.
      </p>
      <div class="bon-sync-actions">
        <label htmlFor="bon-sync-import-file" class="bon-btn">
          Choose file…
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          id="bon-sync-import-file"
          class="bon-sync-file-input"
          onChange={() => void handleFileChange()}
        />
        <button
          type="button"
          class="bon-btn"
          onClick={() => void handlePaste()}
        >
          Paste from clipboard
        </button>
      </div>
      <textarea
        ref={textareaRef}
        class="bon-sync-paste"
        placeholder="…or paste a backup JSON payload here. Parses as you type."
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        onInput={(event) => {
          if (event.currentTarget.value.length > 0 && fileRef.current) {
            fileRef.current.value = "";
          }

          tryParseText(event.currentTarget.value, "Pasted text");
        }}
      />
      {parsed && (
        <div class="bon-sync-preview">
          <dl class="bon-sync-preview-summary">
            <dt>File</dt>
            <dd>{parsed.sourceLabel}</dd>
            <dt>Backup version</dt>
            <dd>v{parsed.payload.bonBackup}</dd>
            <dt>From app version</dt>
            <dd>{parsed.payload.appVersion}</dd>
            {parsed.payload.exportedAt && (
              <>
                <dt>Exported</dt>
                <dd>{new Date(parsed.payload.exportedAt).toLocaleString()}</dd>
              </>
            )}
            <dt>Users in backup</dt>
            <dd>{Object.keys(parsed.payload.reports).length}</dd>
          </dl>
          <div class="bon-sync-actions">
            <button
              type="button"
              class="bon-btn"
              disabled={merging}
              onClick={() => void handleMerge()}
            >
              {merging ? "Merging…" : "Merge into my data"}
            </button>
          </div>
        </div>
      )}
      <p class={statusClass(note.tone)}>{note.text}</p>
    </div>
  );
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

export {
  syncConfigure,
  syncCreateGist,
  syncDisable,
  syncExport,
  syncImport,
  syncNow,
  syncStatus,
} from "./handlers.ts";
export {
  syncBackgroundInit,
  syncHandleStorageChange,
  syncOnAlarm,
} from "./schedule.ts";
