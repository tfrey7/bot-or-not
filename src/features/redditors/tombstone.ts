// Small grave marker shown next to a username when the account is gone —
// suspended (sitewide ban) or deleted. Driven by `userStatus`, which the
// weekly status re-check (features/status-recheck) and the passive
// content-script detector (features/status-detection) both maintain. It's a
// state glyph, not identifying text, so it carries no PII class and sits as a
// sibling of the username link (outside the blur box) like the ring chip.

import type { Report } from "../../types.ts";

export function buildTombstone(
  status: Report["userStatus"]
): HTMLElement | null {
  if (status !== "suspended" && status !== "deleted") {
    return null;
  }

  const marker = document.createElement("span");
  marker.className = "bon-tombstone";
  marker.textContent = "🪦";
  marker.setAttribute("aria-hidden", "true");
  marker.title =
    status === "suspended" ? "Account suspended (banned)" : "Account deleted";

  return marker;
}
