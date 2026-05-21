// Storage adapter — the single seam between application code and whatever
// backs persistence underneath. Today that's `browser.storage.local`; the
// same interface could be implemented against a server's HTTP API to host
// the same code as a website with a real backend.
//
// All sanctioned reads/writes go through the module-level functions below.
// `bonStorage` is the live implementation; swapping it for a different class
// is the only change needed to retarget the backend.

import type { Report } from "./types.ts";
import { bonNormalizeReport } from "./utils/history.ts";

export interface BonStorage {
  readReports(): Promise<Record<string, Report>>;
  writeReports(reports: Record<string, Report>): Promise<void>;

  readApiKey(): Promise<string>;
  writeApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

class BonExtensionStorage implements BonStorage {
  async readReports(): Promise<Record<string, Report>> {
    const raw = (await browser.storage.local.get("reports")) as {
      reports?: Record<string, unknown>;
    };
    const out: Record<string, Report> = {};

    for (const [username, value] of Object.entries(raw.reports ?? {})) {
      out[username] = bonNormalizeReport(value);
    }

    return out;
  }

  async writeReports(reports: Record<string, Report>): Promise<void> {
    await browser.storage.local.set({ reports });
  }

  async readApiKey(): Promise<string> {
    const { claudeApiKey = "" } = (await browser.storage.local.get(
      "claudeApiKey"
    )) as { claudeApiKey?: string };

    return claudeApiKey;
  }

  async writeApiKey(key: string): Promise<void> {
    await browser.storage.local.set({ claudeApiKey: key });
  }

  async clearApiKey(): Promise<void> {
    await browser.storage.local.remove("claudeApiKey");
  }
}

const bonStorage: BonStorage = new BonExtensionStorage();

// Module-level function wrappers — the public API everywhere else in the
// codebase consumes. Function-style is consistent with the rest of the
// project's exports and keeps callsites stable if the singleton ever
// becomes injected.

export function bonReadReports(): Promise<Record<string, Report>> {
  return bonStorage.readReports();
}

export function bonWriteReports(
  reports: Record<string, Report>
): Promise<void> {
  return bonStorage.writeReports(reports);
}

export function bonReadApiKey(): Promise<string> {
  return bonStorage.readApiKey();
}

export function bonWriteApiKey(key: string): Promise<void> {
  return bonStorage.writeApiKey(key);
}

export function bonClearApiKey(): Promise<void> {
  return bonStorage.clearApiKey();
}
