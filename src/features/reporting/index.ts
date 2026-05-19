// Captures Reddit's report-dialog flow so the extension can track every
// account the user reports. The "..." click on a post/comment fires first
// and gives us the author + context; Reddit's subsequent report-dialog
// clicks live outside that element, so this initial capture is our only
// chance to grab them. The actual Submit click then dispatches the stored
// context to the background.

import { bonInlineTagsBumpReport } from "../inline-tags";

interface ReportContext {
  kind: "post" | "comment";
  permalink: string | null;
  subreddit: string | null;
  postTitle?: string | null;
  postId?: string | null;
  commentId?: string | null;
}

interface PendingReport {
  username: string;
  context: ReportContext;
}

let pendingReport: PendingReport | null = null;

function buildReportContext(event: Event): PendingReport | null {
  const authorElement = event
    .composedPath()
    .find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        (element.tagName.toLowerCase() === "shreddit-post" ||
          element.tagName.toLowerCase() === "shreddit-comment") &&
        !!element.getAttribute("author")
    );

  if (!authorElement) {
    return null;
  }

  const username = authorElement.getAttribute("author");
  if (!username) {
    return null;
  }

  const tagName = authorElement.tagName.toLowerCase();
  const context: ReportContext = {
    kind: tagName === "shreddit-post" ? "post" : "comment",
    permalink: authorElement.getAttribute("permalink") || null,
    subreddit:
      authorElement.getAttribute("subreddit-prefixed-name") ||
      authorElement.getAttribute("subreddit-name") ||
      null,
  };

  if (tagName === "shreddit-post") {
    context.postTitle = authorElement.getAttribute("post-title") || null;
    context.postId = authorElement.id || null;
  } else {
    context.commentId =
      authorElement.getAttribute("thingid") ||
      authorElement.getAttribute("comment-id") ||
      authorElement.id ||
      null;
  }
  return { username, context };
}

export function bonReportingInit(): void {
  document.addEventListener(
    "click",
    async function (event) {
      const captured = buildReportContext(event);
      if (captured) {
        pendingReport = captured;
      }

      const reportSpan = event
        .composedPath()
        .find(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            element.classList.contains("report-button-content") &&
            element.textContent?.trim() === "Submit"
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
export function bonReportingResetNav(): void {
  pendingReport = null;
}
