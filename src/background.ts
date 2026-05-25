import { aiCommandHandle, aiCommandReset } from "./features/ai-command";
import { googleAttributionDrain } from "./features/google-harvest";
import type { ScrapedPost } from "./features/google-harvest";
import {
  investigationAutoOnView,
  investigationStart,
  investigationSweepOrphans,
} from "./features/investigation";
import {
  passiveHarvestGetHiddenUsernames,
  passiveHarvestRecord,
} from "./features/passive-harvest";
import type { PassiveHarvestFinding } from "./features/passive-harvest";
import {
  redditorsClearAll,
  redditorsDelete,
  redditorsGetAll,
  redditorsGetReport,
  redditorsGetState,
  redditorsGetTags,
  redditorsLinkRing,
  redditorsRecordReport,
  redditorsSetBotBouncerStatus,
  redditorsSetGoogleHarvest,
  redditorsSetUserNotes,
  redditorsSetUserStatus,
  redditorsUnlinkRing,
  redditorsUpdatePostStatus,
  redditorsUpdateProfileStats,
} from "./features/redditors";
import {
  subredditAnalyze,
  subredditGetReport,
  subredditList,
} from "./features/subreddit-investigation";
import { syncExport, syncImport } from "./features/sync";
import { runMigrations } from "./migrations";
import type { Report } from "./types.ts";
import {
  clearAllApiKeys,
  readAllApiKeys,
  readApiKey,
  readHidePii,
  readLlmSelection,
  writeApiKey,
  writeHidePii,
  writeLlmSelection,
  type ApiKeyMap,
} from "./storage.ts";
import { LLM_VENDORS, sniffVendor, type LlmVendor } from "./llm/index.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import { OpenAIProvider } from "./llm/openai.ts";

console.log("[Bot or Not] background loaded");

void bootstrapDevClaudeApiKey();

void bootstrapDevReportsTab();

void investigationSweepOrphans();

void runMigrations().then(() => {
  // After migrations finish (legacy harvest posts may have just gained
  // their attribution fields), kick the worker so any pending sub-post /
  // comment URLs start trickling toward resolution.
  googleAttributionDrain();
});

// In dev builds running from a strand worktree, Firefox is the human-facing
// test surface — and the reports page is almost always what we want in
// front of us. Have the background open (or refocus) that tab on each
// launch so we don't have to navigate to the moz-extension:// URL by hand.
// Production builds (__STRAND__ is null) tree-shake out.
async function bootstrapDevReportsTab(): Promise<void> {
  if (!__STRAND__) {
    return;
  }

  try {
    const reportsUrl = browser.runtime.getURL("src/reports.html");
    const existing = await browser.tabs.query({ url: reportsUrl });

    if (existing.length > 0) {
      const tab = existing[0];
      if (tab.id !== undefined) {
        await browser.tabs.update(tab.id, { active: true });
      }

      return;
    }

    await browser.tabs.create({ url: reportsUrl, active: true });
  } catch (error) {
    console.error("[Bot or Not] dev: failed to open reports tab", error);
  }
}

async function bootstrapDevClaudeApiKey(): Promise<void> {
  if (!__DEV_CLAUDE_API_KEY__) {
    return;
  }

  try {
    // Dev key seeding is Anthropic-only by convention (the .env slot is
    // named for Claude). If we ever need an OpenAI dev slot it'd be a
    // second env var + a second branch here.
    const existing = await readApiKey("anthropic");

    if (existing) {
      return;
    }

    await writeApiKey("anthropic", __DEV_CLAUDE_API_KEY__);
    console.log("[Bot or Not] dev: seeded Anthropic API key from .env");
  } catch (error) {
    console.error(
      "[Bot or Not] dev: bootstrap of Claude API key failed",
      error
    );
  }
}

interface BaseMessage {
  type: string;
  [k: string]: unknown;
}

// Routes each incoming message to its handler. Pure dispatch — every
// branch unpacks fields from the BaseMessage shape and calls a typed
// handler. Domain logic lives in the feature modules, not here.
browser.runtime.onMessage.addListener((message: BaseMessage) => {
  if (message.type === "report-user") {
    return redditorsRecordReport(
      message.username as string,
      (message.context as Record<string, unknown>) ?? {}
    );
  }

  if (message.type === "get-user-state") {
    return redditorsGetState(message.username as string);
  }

  if (message.type === "get-user-report") {
    return redditorsGetReport(message.username as string);
  }

  if (message.type === "get-user-tags") {
    return redditorsGetTags();
  }

  if (message.type === "get-all-reports") {
    return redditorsGetAll();
  }

  if (message.type === "update-user-status") {
    return redditorsSetUserStatus(
      message.username as string,
      message.status as Report["userStatus"]
    );
  }

  if (message.type === "update-user-profile-stats") {
    return redditorsUpdateProfileStats(
      message.username as string,
      message.createdAt as number | null,
      message.totalKarma as number | null
    );
  }

  if (message.type === "update-post-status") {
    return redditorsUpdatePostStatus(
      message.permalink as string,
      message.status as string
    );
  }

  if (message.type === "set-user-notes") {
    return redditorsSetUserNotes(message.username as string, {
      ratings: Array.isArray(message.ratings)
        ? (message.ratings as string[])
        : [],
      note: (message.note as string) ?? "",
    });
  }

  if (message.type === "update-botbouncer-status") {
    return redditorsSetBotBouncerStatus(
      message.username as string,
      message.status as Report["botBouncerStatus"]
    );
  }

  if (message.type === "clear-all-reports") {
    return redditorsClearAll();
  }

  if (message.type === "delete-report") {
    return redditorsDelete(message.username as string);
  }

  if (message.type === "open-popup") {
    return openReportsTab();
  }

  if (message.type === "open-reports-tab") {
    const username =
      typeof message.username === "string" && message.username
        ? message.username
        : undefined;

    return openReportsTab(username).then(() => ({ ok: true }));
  }

  if (message.type === "investigate-user") {
    return investigationStart(message.username as string);
  }

  if (message.type === "auto-investigate-on-view") {
    return investigationAutoOnView(message.username as string);
  }

  if (message.type === "analyze-subreddit") {
    return subredditAnalyze(message.name as string);
  }

  if (message.type === "get-subreddit-report") {
    return subredditGetReport(message.name as string);
  }

  if (message.type === "list-subreddit-reports") {
    return subredditList();
  }

  if (message.type === "get-api-keys") {
    return handleGetApiKeys();
  }

  if (message.type === "set-api-key") {
    return handleSetApiKey(
      message.apiKey as string,
      (message.vendor as LlmVendor | null | undefined) ?? null
    );
  }

  if (message.type === "clear-api-keys") {
    return handleClearApiKeys();
  }

  if (message.type === "get-llm-selection") {
    return handleGetLlmSelection();
  }

  if (message.type === "set-llm-selection") {
    return handleSetLlmSelection(
      (message.vendor as LlmVendor | null | undefined) ?? null,
      (message.model as string | null | undefined) ?? null
    );
  }

  if (message.type === "get-hide-pii") {
    return readHidePii().then((hidePii) => ({ hidePii }));
  }

  if (message.type === "set-hide-pii") {
    return writeHidePii(!!message.value).then(() => ({ ok: true }));
  }

  if (message.type === "link-ring") {
    return redditorsLinkRing(
      Array.isArray(message.usernames) ? (message.usernames as string[]) : []
    );
  }

  if (message.type === "unlink-ring") {
    return redditorsUnlinkRing(
      Array.isArray(message.usernames) ? (message.usernames as string[]) : []
    );
  }

  if (message.type === "ai-command-reset") {
    aiCommandReset();
    return Promise.resolve({ ok: true });
  }

  if (message.type === "sync-export") {
    return syncExport();
  }

  if (message.type === "sync-import") {
    return syncImport({
      reports: (message.reports as Record<string, Report>) ?? {},
    });
  }

  if (message.type === "get-hidden-usernames") {
    return passiveHarvestGetHiddenUsernames();
  }

  if (message.type === "passive-harvest") {
    const username = (message.username as string) || "";
    const items = Array.isArray(message.items)
      ? (message.items as PassiveHarvestFinding["item"][])
      : [];

    return passiveHarvestRecord(username, items);
  }

  if (message.type === "google-harvest") {
    const username = (message.username as string) || "";
    const query = (message.query as string) || "";
    const incomingPosts = Array.isArray(message.posts)
      ? (message.posts as ScrapedPost[])
      : [];

    if (!username || incomingPosts.length === 0) {
      return Promise.resolve({ ok: false });
    }

    console.log(
      `[Bot or Not] google-harvest: u/${username} — incoming ${incomingPosts.length} post(s) for "${query}"`
    );

    return redditorsSetGoogleHarvest(username, query, incomingPosts).then(
      (result) => {
        // Trickle attribution checks against Reddit for any newly-added
        // sub-post / comment URLs. Independent of investigation runs —
        // the dossier just keeps refining itself in the background.
        googleAttributionDrain();
        return result;
      }
    );
  }
});

// Port channel for the AI command bar. Streamed progress events from the
// agent (tool calls, text deltas, cost) get posted back through the port as
// they happen; the modal stitches them into a live action log. The reports
// page disconnects the port when the operator hits Cancel/Esc — we treat
// that as an abort signal for the in-flight Claude call.
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "ai-command") {
    return;
  }

  const controller = new AbortController();
  let started = false;
  let confirmSeq = 0;
  const pendingConfirms = new Map<number, (approved: boolean) => void>();

  const safePost = (message: unknown): void => {
    try {
      port.postMessage(message);
    } catch {
      // Port already closed — drop the event.
    }
  };

  const resolveAllConfirms = (approved: boolean): void => {
    for (const resolve of pendingConfirms.values()) {
      resolve(approved);
    }

    pendingConfirms.clear();
  };

  port.onDisconnect.addListener(() => {
    if (!controller.signal.aborted) {
      controller.abort();
    }

    // The UI is gone — any awaiting confirm requests would otherwise hang
    // forever. Treat the disconnect as a deny so the agent dispatcher
    // returns an error and the agent loop wraps up cleanly.
    resolveAllConfirms(false);
  });

  port.onMessage.addListener(
    (message: {
      type?: string;
      input?: string;
      id?: number;
      approved?: boolean;
    }) => {
      if (message?.type === "ai-command:confirm-reply") {
        const id = message.id;
        if (typeof id !== "number") {
          return;
        }

        const resolve = pendingConfirms.get(id);
        if (resolve) {
          pendingConfirms.delete(id);
          resolve(!!message.approved);
        }

        return;
      }

      if (message?.type !== "ai-command:start") {
        return;
      }

      if (started) {
        return;
      }

      started = true;

      void aiCommandHandle(message.input ?? "", {
        onProgress: (event) => safePost({ kind: "progress", event }),
        signal: controller.signal,
        requestConfirm: ({ tool, input }) =>
          new Promise<boolean>((resolve) => {
            if (controller.signal.aborted) {
              resolve(false);
              return;
            }

            const id = ++confirmSeq;
            pendingConfirms.set(id, resolve);
            safePost({
              kind: "confirm-request",
              id,
              tool,
              input,
            });
          }),
      })
        .then((result) => {
          safePost({ kind: "result", result });
        })
        .catch((error: unknown) => {
          safePost({
            kind: "error",
            error: String(
              (error as { message?: string })?.message ??
                error ??
                "unknown error"
            ),
          });
        })
        .finally(() => {
          try {
            port.disconnect();
          } catch {
            // Already gone.
          }
        });
    }
  );
});

browser.action.onClicked.addListener(() => {
  void openReportsTab();
});

async function openReportsTab(username?: string): Promise<void> {
  const baseUrl = browser.runtime.getURL("src/reports.html");
  const targetUrl = username
    ? `${baseUrl}?user=${encodeURIComponent(username)}`
    : baseUrl;

  try {
    // Match any reports tab regardless of query string so the deep-link from
    // a profile reuses an already-open reports tab and navigates it to the
    // requested user.
    const existing = await browser.tabs.query({ url: `${baseUrl}*` });
    if (existing && existing.length > 0) {
      const tab = existing[0];
      if (tab.id != null) {
        const update: { active: true; url?: string } = { active: true };
        if (tab.url !== targetUrl) {
          update.url = targetUrl;
        }

        await browser.tabs.update(tab.id, update);
      }

      if (tab.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }

      return;
    }

    await browser.tabs.create({ url: targetUrl });
  } catch (error) {
    console.error("[Bot or Not] openReportsTab failed", error);
  }
}

// One bit per vendor: do we have a key on file? Used by the settings UI
// to render the "Key set" indicator against the currently selected
// vendor. We don't return the keys themselves — they're write-only from
// outside the background.
async function handleGetApiKeys(): Promise<{
  hasKey: Record<LlmVendor, boolean>;
}> {
  const map = await readAllApiKeys();
  return { hasKey: toHasKeyMap(map) };
}

// Sniff the vendor from the key prefix when the caller doesn't pin it
// explicitly. The result is also returned so the settings UI can flip the
// vendor dropdown to match (pasting an Anthropic key while OpenAI is
// selected is almost always a vendor mismatch — fix it for the operator
// rather than silently storing it in the wrong slot).
async function handleSetApiKey(
  apiKey: string,
  hintedVendor: LlmVendor | null
): Promise<{
  ok: true;
  vendor: LlmVendor;
  hasKey: Record<LlmVendor, boolean>;
}> {
  const key = (apiKey || "").trim();

  // Empty key means "delete the entry for this vendor." If we don't know
  // which vendor the caller meant, do nothing — clearing all keys is a
  // separate, explicit message.
  if (!key) {
    if (hintedVendor) {
      const map = await readAllApiKeys();
      delete map[hintedVendor];
      await browser.storage.local.set({ apiKeys: map });
    }

    const map = await readAllApiKeys();
    return {
      ok: true,
      vendor: hintedVendor ?? "anthropic",
      hasKey: toHasKeyMap(map),
    };
  }

  const vendor = sniffVendor(key);
  await writeApiKey(vendor, key);
  const map = await readAllApiKeys();
  return { ok: true, vendor, hasKey: toHasKeyMap(map) };
}

async function handleClearApiKeys(): Promise<{
  ok: true;
  hasKey: Record<LlmVendor, boolean>;
}> {
  await clearAllApiKeys();
  return { ok: true, hasKey: toHasKeyMap({}) };
}

function toHasKeyMap(map: ApiKeyMap): Record<LlmVendor, boolean> {
  const out = {} as Record<LlmVendor, boolean>;

  for (const { id } of LLM_VENDORS) {
    out[id] = !!map[id];
  }

  return out;
}

// Vendor list + model list is provider-owned; the background exposes it
// here so the settings UI doesn't need to know which providers exist.
async function handleGetLlmSelection(): Promise<{
  vendor: LlmVendor | null;
  model: string | null;
  vendors: ReadonlyArray<{ id: LlmVendor; label: string }>;
  modelsByVendor: Record<
    LlmVendor,
    {
      defaultModel: string;
      models: ReadonlyArray<{ id: string; label: string }>;
    }
  >;
}> {
  const stored = await readLlmSelection();

  const anthropic = new AnthropicProvider("");
  const openai = new OpenAIProvider("");

  return {
    vendor: stored.vendor,
    model: stored.model,
    vendors: LLM_VENDORS.map(({ id, label }) => ({ id, label })),
    modelsByVendor: {
      anthropic: {
        defaultModel: anthropic.defaultModel,
        models: anthropic.availableModels.map((m) => ({
          id: m.id,
          label: m.label,
        })),
      },
      openai: {
        defaultModel: openai.defaultModel,
        models: openai.availableModels.map((m) => ({
          id: m.id,
          label: m.label,
        })),
      },
    },
  };
}

async function handleSetLlmSelection(
  vendor: LlmVendor | null,
  model: string | null
): Promise<{ ok: true; vendor: LlmVendor | null; model: string | null }> {
  await writeLlmSelection({ vendor, model });
  return { ok: true, vendor, model };
}
