// Background-context message handler — the reports page reads the sweep's
// bookkeeping through this instead of touching storage directly.

import type { BlocklistCleanupState } from "../../storage";
import { readBlocklistCleanupState } from "../../storage";

export function blocklistCleanupGetState(): Promise<BlocklistCleanupState> {
  return readBlocklistCleanupState();
}
