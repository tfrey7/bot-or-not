// String formatters / escapers. Pure.

// Turns "likely-bot" into "Likely bot" for display.
export function formatVerdict(verdict: string | null | undefined): string {
  if (!verdict) {
    return "";
  }

  const spaced = verdict.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// CSS.escape with a fallback for environments that lack it.
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Returns the pathname portion of a URL for compact logging.
export function shortUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
