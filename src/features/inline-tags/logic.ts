// Pure decisions for the inline username pills. Maps a stored tag info
// object to the variant CSS modifier, the visible label, and the hover
// tooltip. No DOM.

import { bonFormatVerdict } from "../../utils/format_text.ts";

export interface UserTagInfo {
  username: string;
  count: number;
  verdict?: string | null;
  confidence?: number | null;
  investigationStatus?: string | null;
  investigationStartedAt?: number | null;
  botBouncerStatus?: string | null;
  userStatus?: string | null;
  ringId?: string | null;
}

export type TagVariant = string;

export function bonInlineTagVariant(info: UserTagInfo): TagVariant {
  if (info.verdict) {
    return info.verdict;
  }

  if (info.investigationStatus === "running") {
    return "running";
  }

  if (info.count > 0) {
    return "reported";
  }

  if (info.botBouncerStatus === "banned") {
    return "bot";
  }

  if (info.userStatus === "suspended") {
    return "bot";
  }

  // No signal yet — used on post-detail pages so the OP byline always has
  // a clickable entry point to kick off an investigation.
  return "idle";
}

export function bonInlineTagLabel(
  info: UserTagInfo,
  variant: TagVariant
): string {
  if (variant === "running") {
    return "Investigating";
  }

  if (variant === "idle") {
    return "Bot?";
  }

  if (variant === "reported") {
    return info.count > 0
      ? `${info.count} report${info.count === 1 ? "" : "s"}`
      : "Flagged";
  }

  return bonFormatVerdict(variant);
}

export function bonInlineTagTitle(
  info: UserTagInfo,
  variant: TagVariant
): string {
  const parts = [`@${info.username}`];

  if (info.verdict) {
    const confidenceText =
      typeof info.confidence === "number"
        ? ` (${Math.round(info.confidence * 100)}% confidence)`
        : "";
    parts.push(
      `AI verdict: ${bonFormatVerdict(info.verdict)}${confidenceText}`
    );
  } else if (variant === "running") {
    parts.push("AI investigation in progress");
  } else if (variant === "idle") {
    parts.push("Click to investigate");
  }

  if (info.count > 0) {
    parts.push(
      `${info.count} report${info.count === 1 ? "" : "s"} from this extension`
    );
  }

  if (info.botBouncerStatus) {
    parts.push(`Bot Bouncer: ${info.botBouncerStatus}`);
  }

  if (info.userStatus) {
    parts.push(`Account: ${info.userStatus}`);
  }

  if (info.ringId) {
    parts.push(`Ring ${info.ringId}`);
  }

  return parts.join(" — ");
}

// Avatar-wrapping anchors have no visible text. Tagging them puts the pill
// in the wrong layout slot (often a column flex container), so it wraps to
// its own line below the username row.
export function bonInlineTagIsAvatarLink(element: Element): boolean {
  if (element.textContent && element.textContent.trim()) {
    return false;
  }

  return !!element.querySelector("img, svg, shreddit-avatar, faceplate-img");
}
