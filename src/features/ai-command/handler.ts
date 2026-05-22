// Background-context handler for the AI command bar. Runs the agent
// against the operator's input and routes the agent's tool calls into the
// matching reports / investigation handlers. The reports snapshot is
// built lazily by the `list_users` tool dispatch — off-topic or social
// queries never pay to load it.

import { bonInvestigationStart } from "../investigation/handlers.ts";
import { bonReportsComputeRegionForReport } from "../reports/region.ts";
import {
  bonReportsDelete,
  bonReportsLinkRing,
  bonReportsSetUserStatus,
  bonReportsUnlinkRing,
} from "../reports/handlers.ts";
import type { Report } from "../../types.ts";
import {
  bonReadApiKey,
  bonReadLlmSelection,
  bonReadReports,
} from "../../storage.ts";
import { bonFindReportKey } from "../../utils/history.ts";
import {
  bonAiCommandBuildSnapshot,
  bonAiCommandBuildUserDetails,
  bonRunAiCommand,
  type AiCommandDispatch,
  type AiCommandMessage,
  type AiCommandProgress,
  type AiCommandResult,
} from "./index.ts";
import { BON_AI_COMMAND_DESTRUCTIVE_TOOLS } from "./tools.ts";

// Reaches up from the dispatcher into the UI to ask the operator to approve
// a destructive tool call. Resolves to `true` on approve, `false` on deny or
// when the AI command modal is dismissed before the operator answers.
export type BonAiCommandConfirmRequest = (request: {
  tool: string;
  input: Record<string, unknown>;
}) => Promise<boolean>;

// In-memory conversation history. Persists across `ai-command` calls but
// resets on service-worker eviction or extension reload — a hard cap on
// conversation length. The operator can also reset explicitly via
// bonAiCommandReset.
let history: AiCommandMessage[] = [];

export function bonAiCommandReset(): void {
  history = [];
}

export interface BonAiCommandHandleOptions {
  onProgress?: AiCommandProgress;
  signal?: AbortSignal;
  requestConfirm?: BonAiCommandConfirmRequest;
}

export async function bonAiCommandHandle(
  input: string,
  options: BonAiCommandHandleOptions = {}
): Promise<AiCommandResult | { ok: false; error: string }> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "empty-input" };
  }

  const selection = await bonReadLlmSelection();
  const vendor = selection.vendor ?? "anthropic";
  const apiKey = await bonReadApiKey(vendor);

  if (!apiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const result = await bonRunAiCommand(
    apiKey,
    trimmed,
    makeDispatchTool(options.requestConfirm),
    {
      history,
      onProgress: options.onProgress,
      signal: options.signal,
      vendor,
      model: selection.model,
    }
  );

  // Persist the updated transcript so the next call sees this turn as prior
  // context.
  history = result.history;
  return result;
}

function makeDispatchTool(
  requestConfirm: BonAiCommandConfirmRequest | undefined
): AiCommandDispatch {
  return async (tool, args) => {
    if (BON_AI_COMMAND_DESTRUCTIVE_TOOLS.has(tool)) {
      // Without a confirm channel, refuse destructive calls outright rather
      // than executing silently. The reports-page port always supplies one;
      // callers running headless (CLI, tests) would need to opt in explicitly.
      if (!requestConfirm) {
        return {
          ok: false,
          error: "destructive tools require operator confirmation",
        };
      }

      const approved = await requestConfirm({ tool, input: args });
      if (!approved) {
        return { ok: false, error: "operator declined" };
      }
    }

    return dispatch(tool, args);
  };
}

const dispatch: AiCommandDispatch = async (tool, args) => {
  if (tool === "list_users") {
    // Build the snapshot on demand. Region inference per user is CPU-bound
    // but cheap (~ms for hundreds of reports) — skipping it on off-topic
    // queries is still a real win.
    const latest = await bonReadReports();
    const regions: Record<string, string | null> = {};

    for (const [username, report] of Object.entries(latest)) {
      const result = bonReportsComputeRegionForReport({ username, ...report });
      regions[username] =
        result?.kind === "ai" || result?.kind === "deterministic"
          ? result.region
          : null;
    }

    const snapshot = bonAiCommandBuildSnapshot(latest, regions);
    return { ok: true, count: snapshot.length, users: snapshot };
  }

  if (tool === "link_ring") {
    return bonReportsLinkRing(args.usernames as string[]);
  }

  if (tool === "unlink_ring") {
    return bonReportsUnlinkRing(args.usernames as string[]);
  }

  if (tool === "delete_report") {
    return bonReportsDelete(args.username as string);
  }

  if (tool === "investigate_user") {
    // Don't block the agent loop on a full ~60s investigation — fire it off
    // and report back immediately. The reports page polls and the row flips
    // to "running" on its own.
    void bonInvestigationStart(args.username as string);
    return { ok: true, started: true };
  }

  if (tool === "set_user_status") {
    await bonReportsSetUserStatus(
      args.username as string,
      args.status as Report["userStatus"]
    );

    return { ok: true };
  }

  if (tool === "filter_users") {
    // UI-only action — the input list flows through to the reports page via
    // the agent's actions[] and gets applied as a visible-row gate.
    const usernames = Array.isArray(args.usernames)
      ? (args.usernames as string[])
      : [];

    return { ok: true, count: usernames.length };
  }

  if (tool === "read_user_details") {
    const requested = Array.isArray(args.usernames)
      ? (args.usernames as string[])
      : [];

    const latest = await bonReadReports();
    const users = requested.map((name) => {
      const trimmed = (name ?? "").trim();
      const key = bonFindReportKey(latest, trimmed);
      if (!key) {
        return bonAiCommandBuildUserDetails(trimmed, undefined);
      }

      return bonAiCommandBuildUserDetails(key, latest[key]);
    });

    return { ok: true, users };
  }

  if (tool === "navigate_to_user") {
    // Storage-side no-op — resolve the username to the canonical stored key
    // and hand it back so the reports page can select that row after the
    // agent returns. Tries exact (case-insensitive) match first, then falls
    // back to a substring match so a partial reference like "spam" still
    // lands somewhere reasonable if Claude passed the operator's phrasing
    // through without resolving it against the snapshot.
    const requested = ((args.username as string) ?? "").trim();
    const latest = await bonReadReports();

    let key = bonFindReportKey(latest, requested);

    if (!key && requested) {
      const needle = requested.toLowerCase();
      const candidates = Object.keys(latest).filter((name) =>
        name.toLowerCase().includes(needle)
      );

      // Shortest match wins — "alice" in {"alice42", "alice_test_account"}
      // prefers "alice42" as the tighter fit.
      candidates.sort((a, b) => a.length - b.length);
      key = candidates[0] ?? null;
    }

    if (!key) {
      return { ok: false, error: `unknown user: ${requested}` };
    }

    return { ok: true, username: key };
  }

  return { ok: false, error: `unknown tool: ${tool}` };
};
