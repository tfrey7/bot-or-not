// String formatters / escapers. Pure.

(function () {
  // Turns "likely-bot" into "Likely bot" for display.
  function bonFormatVerdict(verdict) {
    if (!verdict) {
      return "";
    }
    const spaced = verdict.replace(/-/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // CSS.escape with a fallback for environments that lack it.
  function bonCssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // Returns the pathname portion of a URL for compact logging.
  function bonShortUrl(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  globalThis.bonFormatVerdict = bonFormatVerdict;
  globalThis.bonCssEscape = bonCssEscape;
  globalThis.bonShortUrl = bonShortUrl;
})();
