// Background-context handler for the AI command bar. Builds a snapshot of
// the current reports, runs the agent against it, and routes the agent's
// tool calls into the matching reports / investigation handlers.

import { bonInvestigationStart } from "../investigation/handlers.ts";
import { bonReportsComputeRegionForReport } from "../reports/logic.ts";
import {
  bonReportsDelete,
  bonReportsLinkRing,
  bonReportsSetUserStatus,
  bonReportsUnlinkRing,
} from "../reports/handlers.ts";
import type { Report } from "../../types.ts";
import { bonFindReportKey, bonReadReports } from "../../utils/history.ts";
import {
  bonAiCommandBuildSnapshot,
  bonAiCommandBuildUserDetails,
  bonRunAiCommand,
  type AiCommandDispatch,
  type AiCommandMessage,
  type AiCommandResult,
} from "./index.ts";

// In-memory conversation history. Persists across `ai-command` calls but
// resets on service-worker eviction or extension reload — a hard cap on
// conversation length. The operator can also reset explicitly via
// bonAiCommandReset.
let history: AiCommandMessage[] = [];

export function bonAiCommandReset(): void {
  history = [];
}

export async function bonAiCommandHandle(
  input: string
): Promise<AiCommandResult | { ok: false; error: string }> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "empty-input" };
  }

  const { claudeApiKey = "" } = (await browser.storage.local.get(
    "claudeApiKey"
  )) as { claudeApiKey?: string };

  if (!claudeApiKey) {
    return { ok: false, error: "no-api-key" };
  }

  const reports = await bonReadReports();

  // Compute a country code per user so the agent can answer "filter to US
  // accounts" without us shipping all the underlying signals. Soft inferences
  // (timezone-only band) collapse to null — too noisy as a filter target.
  const regions: Record<string, string | null> = {};

  for (const [username, report] of Object.entries(reports)) {
    const result = bonReportsComputeRegionForReport({ username, ...report });
    regions[username] =
      result?.kind === "ai" || result?.kind === "deterministic"
        ? result.region
        : null;
  }

  const snapshot = bonAiCommandBuildSnapshot(reports, regions);

  const result = await bonRunAiCommand(
    claudeApiKey,
    snapshot,
    trimmed,
    dispatchTool,
    history
  );

  // Persist the updated transcript so the next call sees this turn as prior
  // context.
  history = result.history;
  return result;
}

const dispatchTool: AiCommandDispatch = async (tool, args) => {
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
