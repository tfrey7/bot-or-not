// GitHub-gist transport for automatic sync. One private gist holds a single
// backup file; every machine reconciles by pulling that file, merging it into
// local storage with syncMergeReports, and pushing the merged result back.
//
// The gist API has no compare-and-swap, so two machines pushing at once can
// clobber each other's write. That's tolerable because the merge is a union
// that keeps the newest of each field: whichever machine loses a race still
// holds its own data locally and re-contributes it on its next reconcile, so
// the gist converges. Deletions are the exception — a union merge can't
// express "removed", so a deleted report reappears from the other machine.

import type { Report } from "../../types.ts";
import {
  readReports,
  readSyncConfig,
  writeReports,
  writeSyncConfig,
} from "../../storage";
import {
  syncBuildBackup,
  syncMergeReports,
  syncParseBackup,
  type MergeStats,
  type SyncBackupPayload,
} from "./logic.ts";

const GITHUB_API = "https://api.github.com";
const BACKUP_FILENAME = "bot-or-not-backup.json";
const GIST_DESCRIPTION = "Bot or Not — automatic sync (do not edit by hand)";

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

interface GistResponse {
  id?: string;
  files?: Record<string, GistFile>;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubError(res: Response, action: string): Promise<string> {
  const text = await res.text();
  let detail = text;

  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") {
      detail = body.message;
    }
  } catch {
    // Non-JSON error body — fall back to the raw text.
  }

  return `GitHub ${action} failed (${res.status}): ${detail || res.statusText}`;
}

function appVersion(): string {
  return browser.runtime.getManifest().version;
}

// Creates the private gist that will hold the shared backup and returns its
// id. Seeds it with an empty payload so the first pull from the other machine
// parses cleanly.
export async function createSyncGist(token: string): Promise<string> {
  const payload = syncBuildBackup({ reports: {}, appVersion: appVersion() });

  const res = await fetch(`${GITHUB_API}/gists`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [BACKUP_FILENAME]: { content: JSON.stringify(payload) } },
    }),
  });

  if (!res.ok) {
    throw new Error(await githubError(res, "create gist"));
  }

  const gist = (await res.json()) as GistResponse;
  if (!gist.id) {
    throw new Error("GitHub did not return a gist id.");
  }

  return gist.id;
}

async function pullRemote(
  gistId: string,
  token: string
): Promise<Record<string, Report>> {
  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    throw new Error(await githubError(res, "read gist"));
  }

  const gist = (await res.json()) as GistResponse;
  const file = gist.files?.[BACKUP_FILENAME];
  if (!file) {
    return {};
  }

  let content = file.content ?? "";

  // GitHub inlines file content only up to ~1 MB; larger files come back
  // flagged truncated with a raw_url pointing at the full blob.
  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url, { headers: authHeaders(token) });
    if (!rawRes.ok) {
      throw new Error(await githubError(rawRes, "read gist content"));
    }

    content = await rawRes.text();
  }

  if (!content.trim()) {
    return {};
  }

  const parsed = syncParseBackup(content);
  if (!parsed.ok) {
    throw new Error(`Remote backup is unreadable: ${parsed.error}`);
  }

  return parsed.payload.reports;
}

async function pushRemote(
  gistId: string,
  token: string,
  payload: SyncBackupPayload
): Promise<void> {
  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({
      files: { [BACKUP_FILENAME]: { content: JSON.stringify(payload) } },
    }),
  });

  if (!res.ok) {
    throw new Error(await githubError(res, "write gist"));
  }
}

// One full reconcile cycle. Records the outcome on the SyncConfig so the
// settings UI can show "last synced" / the last error, then rethrows so a
// manual "Sync now" can surface the failure while scheduled callers swallow.
export async function syncReconcile(): Promise<MergeStats> {
  const config = await readSyncConfig();
  if (!config.enabled || !config.gistId || !config.token) {
    throw new Error("Automatic sync is not configured.");
  }

  const { gistId, token } = config;

  try {
    const remote = await pullRemote(gistId, token);
    const local = await readReports();
    const { reports: merged, stats } = syncMergeReports(local, remote);

    if (stats.added.length > 0 || stats.merged.length > 0) {
      await writeReports(merged);
    }

    const payload = syncBuildBackup({
      reports: merged,
      appVersion: appVersion(),
    });
    await pushRemote(gistId, token, payload);

    await writeSyncConfig({
      ...config,
      lastSyncedAt: Date.now(),
      lastError: null,
    });

    return stats;
  } catch (error) {
    await writeSyncConfig({ ...config, lastError: (error as Error).message });
    throw error;
  }
}
