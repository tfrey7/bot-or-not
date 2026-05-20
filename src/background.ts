import {
  bonAiCommandHandle,
  bonAiCommandReset,
} from "./features/ai-command/handler.ts";
import {
  bonInvestigationAutoOnView,
  bonInvestigationStart,
  bonInvestigationSweepOrphans,
} from "./features/investigation/handlers.ts";
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
import { BON_DEV_REFERENCE_ACCOUNTS } from "./dev_reference_accounts.ts";
import { bonRunMigrations } from "./migrations";
import type { Report } from "./types.ts";
import type { BonScrapedPost } from "./features/google-harvest/parse.ts";
import {
  bonFindReportKey,
  bonNormalizeReport,
  bonReadReports,
  bonWriteReports,
} from "./utils/history.ts";

console.log("[Bot or Not] background loaded");

void bootstrapDevClaudeApiKey();

// Re-seed the reports list with a curated set of known accounts on every
// dev startup so UI iteration (sorting, table layout, etc.) always has
// data to work against after a Firefox profile wipe or web-ext reload.
// Tree-shakes out of production via the import.meta.env.DEV guard.
void bootstrapDevReferenceAccounts();

void bonInvestigationSweepOrphans();

void bonRunMigrations();

async function bootstrapDevClaudeApiKey(): Promise<void> {
  if (!__BON_DEV_CLAUDE_API_KEY__) {
    return;
  }

  try {
    const { claudeApiKey = "" } = (await browser.storage.local.get(
      "claudeApiKey"
    )) as { claudeApiKey?: string };

    if (claudeApiKey) {
      return;
    }

    await browser.storage.local.set({
      claudeApiKey: __BON_DEV_CLAUDE_API_KEY__,
    });
    console.log("[Bot or Not] dev: seeded Claude API key from .env");
  } catch (error) {
    console.error(
      "[Bot or Not] dev: bootstrap of Claude API key failed",
      error
    );
  }
}

async function bootstrapDevReferenceAccounts(): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }

  try {
    const reports = await bonReadReports();
    const seededAt = Date.now();
    const added: string[] = [];

    for (const { username, note } of BON_DEV_REFERENCE_ACCOUNTS) {
      if (bonFindReportKey(reports, username)) {
        continue;
      }

      const base = bonNormalizeReport(undefined);
      reports[username] = {
        ...base,
        count: 1,
        lastReportedAt: seededAt,
        history: [{ at: seededAt, kind: "dev-seed", note }],
      };
      added.push(username);
    }

    if (added.length > 0) {
      await bonWriteReports(reports);
      console.log(
        `[Bot or Not] dev: seeded ${added.length} reference account(s): ${added.join(", ")}`
      );
    }
  } catch (error) {
    console.error(
      "[Bot or Not] dev: bootstrap of reference accounts failed",
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
      rating: (message.rating as string | null) ?? null,
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

  if (message.type === "ai-command") {
    return bonAiCommandHandle(message.input as string);
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

    return bonReportsSetGoogleHarvest(username, query, incomingPosts);
  }
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
  const { claudeApiKey = "" } = (await browser.storage.local.get(
    "claudeApiKey"
  )) as { claudeApiKey?: string };

  return { hasKey: !!claudeApiKey };
}

async function handleSetClaudeApiKey(
  apiKey: string
): Promise<{ ok: boolean; hasKey: boolean }> {
  const key = (apiKey || "").trim();
  if (!key) {
    await browser.storage.local.remove("claudeApiKey");
    return { ok: true, hasKey: false };
  }

  await browser.storage.local.set({ claudeApiKey: key });
  return { ok: true, hasKey: true };
}
