import {
  bonAiCommandHandle,
  bonAiCommandReset,
} from "./features/ai-command/handler.ts";
import { bonGoogleAttributionDrain } from "./features/google-harvest/attribution.ts";
import {
  bonInvestigationAutoOnView,
  bonInvestigationStart,
  bonInvestigationSweepOrphans,
} from "./features/investigation/handlers.ts";
import {
  bonPassiveHarvestGetHiddenUsernames,
  bonPassiveHarvestRecord,
} from "./features/passive-harvest/handlers.ts";
import type { BonPassiveHarvestFinding } from "./features/passive-harvest/scrape.ts";
import {
  bonReportsClearAll,
  bonReportsDelete,
  bonReportsGetAll,
  bonReportsGetReport,
  bonReportsGetState,
  bonReportsGetTags,
  bonReportsLinkRing,
  bonReportsRecordReport,
  bonReportsSetBotBouncerStatus,
  bonReportsSetGoogleHarvest,
  bonReportsSetUserNotes,
  bonReportsSetUserStatus,
  bonReportsUnlinkRing,
  bonReportsUpdatePostStatus,
  bonReportsUpdateProfileStats,
} from "./features/reports/handlers.ts";
import { bonSyncExport, bonSyncImport } from "./features/sync/handlers.ts";
import { bonRunMigrations } from "./migrations";
import type { Report } from "./types.ts";
import type { BonScrapedPost } from "./features/google-harvest/parse.ts";
import { bonClearApiKey, bonReadApiKey, bonWriteApiKey } from "./storage.ts";

console.log("[Bot or Not] background loaded");

void bootstrapDevClaudeApiKey();

void bootstrapDevReportsTab();

void bonInvestigationSweepOrphans();

void bonRunMigrations().then(() => {
  // After migrations finish (legacy harvest posts may have just gained
  // their attribution fields), kick the worker so any pending sub-post /
  // comment URLs start trickling toward resolution.
  bonGoogleAttributionDrain();
});

// In dev builds spawned for a specific agent (new-agent.sh worktree), Firefox
// is the human-facing test surface — and the reports page is almost always
// what we want in front of us. Have the background open (or refocus) that
// tab on each launch so we don't have to navigate to the moz-extension://
// URL by hand. Production builds (__BON_AGENT__ is null) tree-shake out.
async function bootstrapDevReportsTab(): Promise<void> {
  if (!__BON_AGENT__) {
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
  if (!__BON_DEV_CLAUDE_API_KEY__) {
    return;
  }

  try {
    const claudeApiKey = await bonReadApiKey();

    if (claudeApiKey) {
      return;
    }

    await bonWriteApiKey(__BON_DEV_CLAUDE_API_KEY__);
    console.log("[Bot or Not] dev: seeded Claude API key from .env");
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
    return bonReportsRecordReport(
      message.username as string,
      (message.context as Record<string, unknown>) ?? {}
    );
  }

  if (message.type === "get-user-state") {
    return bonReportsGetState(message.username as string);
  }

  if (message.type === "get-user-report") {
    return bonReportsGetReport(message.username as string);
  }

  if (message.type === "get-user-tags") {
    return bonReportsGetTags();
  }

  if (message.type === "get-all-reports") {
    return bonReportsGetAll();
  }

  if (message.type === "update-user-status") {
    return bonReportsSetUserStatus(
      message.username as string,
      message.status as Report["userStatus"]
    );
  }

  if (message.type === "update-user-profile-stats") {
    return bonReportsUpdateProfileStats(
      message.username as string,
      message.createdAt as number | null,
      message.totalKarma as number | null
    );
  }

  if (message.type === "update-post-status") {
    return bonReportsUpdatePostStatus(
      message.permalink as string,
      message.status as string
    );
  }

  if (message.type === "set-user-notes") {
    return bonReportsSetUserNotes(message.username as string, {
      ratings: Array.isArray(message.ratings)
        ? (message.ratings as string[])
        : [],
      note: (message.note as string) ?? "",
    });
  }

  if (message.type === "update-botbouncer-status") {
    return bonReportsSetBotBouncerStatus(
      message.username as string,
      message.status as Report["botBouncerStatus"]
    );
  }

  if (message.type === "clear-all-reports") {
    return bonReportsClearAll();
  }

  if (message.type === "delete-report") {
    return bonReportsDelete(message.username as string);
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
    return bonInvestigationStart(message.username as string);
  }

  if (message.type === "auto-investigate-on-view") {
    return bonInvestigationAutoOnView(message.username as string);
  }

  if (message.type === "get-claude-api-key") {
    return handleGetClaudeApiKey();
  }

  if (message.type === "set-claude-api-key") {
    return handleSetClaudeApiKey(message.apiKey as string);
  }

  if (message.type === "link-ring") {
    return bonReportsLinkRing(
      Array.isArray(message.usernames) ? (message.usernames as string[]) : []
    );
  }

  if (message.type === "unlink-ring") {
    return bonReportsUnlinkRing(
      Array.isArray(message.usernames) ? (message.usernames as string[]) : []
    );
  }

  if (message.type === "ai-command-reset") {
    bonAiCommandReset();
    return Promise.resolve({ ok: true });
  }

  if (message.type === "sync-export") {
    return bonSyncExport();
  }

  if (message.type === "sync-import") {
    return bonSyncImport({
      reports: (message.reports as Record<string, Report>) ?? {},
    });
  }

  if (message.type === "get-hidden-usernames") {
    return bonPassiveHarvestGetHiddenUsernames();
  }

  if (message.type === "passive-harvest") {
    const username = (message.username as string) || "";
    const items = Array.isArray(message.items)
      ? (message.items as BonPassiveHarvestFinding["item"][])
      : [];

    return bonPassiveHarvestRecord(username, items);
  }

  if (message.type === "google-harvest") {
    const username = (message.username as string) || "";
    const query = (message.query as string) || "";
    const incomingPosts = Array.isArray(message.posts)
      ? (message.posts as BonScrapedPost[])
      : [];

    if (!username || incomingPosts.length === 0) {
      return Promise.resolve({ ok: false });
    }

    console.log(
      `[Bot or Not] google-harvest: u/${username} — incoming ${incomingPosts.length} post(s) for "${query}"`
    );

    return bonReportsSetGoogleHarvest(username, query, incomingPosts).then(
      (result) => {
        // Trickle attribution checks against Reddit for any newly-added
        // sub-post / comment URLs. Independent of investigation runs —
        // the dossier just keeps refining itself in the background.
        bonGoogleAttributionDrain();
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

  const safePost = (message: unknown): void => {
    try {
      port.postMessage(message);
    } catch {
      // Port already closed — drop the event.
    }
  };

  port.onDisconnect.addListener(() => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  });

  port.onMessage.addListener((message: { type?: string; input?: string }) => {
    if (message?.type !== "ai-command:start") {
      return;
    }

    if (started) {
      return;
    }

    started = true;

    void bonAiCommandHandle(message.input ?? "", {
      onProgress: (event) => safePost({ kind: "progress", event }),
      signal: controller.signal,
    })
      .then((result) => {
        safePost({ kind: "result", result });
      })
      .catch((error: unknown) => {
        safePost({
          kind: "error",
          error: String(
            (error as { message?: string })?.message ?? error ?? "unknown error"
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
  });
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

async function handleGetClaudeApiKey(): Promise<{ hasKey: boolean }> {
  const claudeApiKey = await bonReadApiKey();
  return { hasKey: !!claudeApiKey };
}

async function handleSetClaudeApiKey(
  apiKey: string
): Promise<{ ok: boolean; hasKey: boolean }> {
  const key = (apiKey || "").trim();
  if (!key) {
    await bonClearApiKey();
    return { ok: true, hasKey: false };
  }

  await bonWriteApiKey(key);
  return { ok: true, hasKey: true };
}
