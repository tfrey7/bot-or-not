// Captures Reddit's report-dialog flow so the extension can track every
// account the user reports. The "..." click on a post/comment fires first
// and gives us the author + context; Reddit's subsequent report-dialog
// clicks live outside that element, so this initial capture is our only
// chance to grab them. The actual Submit click then dispatches the stored
// context to the background.

import { bonInlineTagsBumpReport } from "../inline-tags/index.js";

let pendingReport = null;

function buildReportContext(e) {
  const authorEl = e
    .composedPath()
    .find(
      (el) =>
        el.tagName &&
        (el.tagName.toLowerCase() === "shreddit-post" ||
          el.tagName.toLowerCase() === "shreddit-comment") &&
        el.getAttribute("author")
    );
  if (!authorEl) {
    return null;
  }

  const username = authorEl.getAttribute("author");
  if (!username) {
    return null;
  }

  const tag = authorEl.tagName.toLowerCase();
  const context = {
    kind: tag === "shreddit-post" ? "post" : "comment",
    permalink: authorEl.getAttribute("permalink") || null,
    subreddit:
      authorEl.getAttribute("subreddit-prefixed-name") ||
      authorEl.getAttribute("subreddit-name") ||
      null,
  };
  if (tag === "shreddit-post") {
    context.postTitle = authorEl.getAttribute("post-title") || null;
    context.postId = authorEl.id || null;
  } else {
    context.commentId =
      authorEl.getAttribute("thingid") ||
      authorEl.getAttribute("comment-id") ||
      authorEl.id ||
      null;
  }
  return { username, context };
}

export function bonReportingInit() {
  document.addEventListener(
    "click",
    async function (e) {
      const cached = buildReportContext(e);
      if (cached) {
        pendingReport = cached;
      }

      const reportSpan = e
        .composedPath()
        .find(
          (el) =>
            el.classList &&
            el.classList.contains("report-button-content") &&
            el.textContent.trim() === "Submit"
        );
      if (reportSpan && pendingReport) {
        const { username, context } = pendingReport;
        await browser.runtime.sendMessage({
          type: "report-user",
          username,
          context,
        });
        bonInlineTagsBumpReport(username);
        pendingReport = null;
      }
    },
    true // capture phase — fires before Reddit's own handlers
  );
}

// Called by the orchestrator on SPA navigation so a half-captured report
// context from the previous page doesn't bleed into the next one.
export function bonReportingResetNav() {
  pendingReport = null;
}
