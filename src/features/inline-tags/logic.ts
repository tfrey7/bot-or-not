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
  return "reported";
}

export function bonInlineTagLabel(
  info: UserTagInfo,
  variant: TagVariant
): string {
  if (variant === "running") {
    return "Investigating";
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
    const conf =
      typeof info.confidence === "number"
        ? ` (${Math.round(info.confidence * 100)}% confidence)`
        : "";
    parts.push(`AI verdict: ${bonFormatVerdict(info.verdict)}${conf}`);
  } else if (variant === "running") {
    parts.push("AI investigation in progress");
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
  return parts.join(" — ");
}

// Avatar-wrapping anchors have no visible text. Tagging them puts the pill
// in the wrong layout slot (often a column flex container), so it wraps to
// its own line below the username row.
export function bonInlineTagIsAvatarLink(el: Element): boolean {
  if (el.textContent && el.textContent.trim()) {
    return false;
  }
  return !!el.querySelector("img, svg, shreddit-avatar, faceplate-img");
}
