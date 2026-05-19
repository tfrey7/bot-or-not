// Diagnostic overlay: draws colored boxes + labels on every shreddit-comment
// and shreddit-post element this feature targets, so screenshots can show
// where the orchestrator THINKS the author / body / share-anchor live versus
// what's actually visible. Toggle via the DEBUG constant; should be turned
// off once the injection lands in the right place.

const DEBUG_ENABLED = true;

const COLORS = {
  comment: "#00ff44",
  post: "#00ccff",
  body: "#ff66ff",
  meta: "#ffcc00",
  shareAnchor: "#ff0044",
  parent: "#ff8800",
  notFound: "#ff0000",
};

function clearOverlays(): void {
  document
    .querySelectorAll(".bon-debug-overlay")
    .forEach((element) => element.remove());
  document
    .querySelectorAll(".bon-debug-pill")
    .forEach((element) => element.remove());
}

// Injects a bright fake pill at the simulated insertion point so we can see
// exactly where the real "Add context" button would land — regardless of
// whether the comment's author is a reported user.
function injectDebugPill(insertAfter: HTMLElement, label: string): void {
  const pill = document.createElement("span");
  pill.className = "bon-debug-pill";
  pill.textContent = `[${label}]`;
  pill.style.cssText = [
    "display: inline-flex",
    "align-items: center",
    "margin: 0 0 0 0.4em",
    "padding: 0.3em 0.7em",
    "background: #ff00ff",
    "color: #fff",
    "font-size: 0.72em",
    "font-weight: 700",
    "font-family: monospace",
    "border: 2px solid #fff",
    "border-radius: 999px",
    "white-space: nowrap",
    "z-index: 2147483641",
    "position: relative",
    "vertical-align: middle",
    "line-height: 1.2",
  ].join(";");
  insertAfter.insertAdjacentElement("afterend", pill);
  // Verify it actually landed in the DOM (sometimes Reddit's lit-html
  // reconciliation throws our changes away). Log after a microtask + frame so
  // we observe the post-render state.
  requestAnimationFrame(() => {
    const stillThere = pill.isConnected;
    const rect = pill.getBoundingClientRect();
    console.log(
      `[Bot or Not] debug pill ${label}: connected=${stillThere} ` +
        `rect=${rect.width}x${rect.height}@(${Math.round(rect.x)},${Math.round(rect.y)})`
    );
  });
}

function drawBox(target: Element, label: string, color: string): void {
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "bon-debug-overlay";
  overlay.style.cssText = [
    "position: absolute",
    `top: ${rect.top + window.scrollY}px`,
    `left: ${rect.left + window.scrollX}px`,
    `width: ${rect.width}px`,
    `height: ${rect.height}px`,
    `outline: 2px dashed ${color}`,
    "outline-offset: -2px",
    "pointer-events: none",
    "z-index: 2147483640",
  ].join(";");
  const labelElement = document.createElement("div");
  labelElement.style.cssText = [
    "position: absolute",
    "top: 0",
    "left: 0",
    `background: ${color}`,
    "color: black",
    "font-size: 10px",
    "font-family: monospace",
    "font-weight: 700",
    "padding: 1px 4px",
    "white-space: nowrap",
    "line-height: 1.2",
  ].join(";");
  labelElement.textContent = label;
  overlay.appendChild(labelElement);
  document.body.appendChild(overlay);
}

function findShareAnchor(scope: Element): HTMLElement | null {
  let shareButton: HTMLElement | null = scope.querySelector<HTMLElement>(
    'button[aria-label="Share"], a[aria-label="Share"]'
  );
  if (!shareButton) {
    const candidates = scope.querySelectorAll<HTMLElement>(
      'button, a[role="button"]'
    );
    for (const candidate of candidates) {
      if ((candidate.textContent || "").trim().toLowerCase() === "share") {
        shareButton = candidate;
        break;
      }
    }
  }
  if (!shareButton) {
    return null;
  }
  return (
    shareButton.closest<HTMLElement>(
      "faceplate-tracker, faceplate-dropdown-menu"
    ) || shareButton
  );
}

// Walks up from the Share button looking for the outermost flex container
// that also contains a Reply button — that's the real action row whose
// layout we want to join.
function findOuterActionRow(
  scope: Element,
  shareButton: HTMLElement
): HTMLElement | null {
  let candidate: HTMLElement | null = shareButton.parentElement;
  while (candidate && candidate !== scope && candidate !== document.body) {
    const buttons = candidate.querySelectorAll<HTMLElement>(
      'button, a[role="button"]'
    );
    let hasReply = false;
    for (const button of buttons) {
      if ((button.textContent || "").trim().toLowerCase() === "reply") {
        hasReply = true;
        break;
      }
    }
    if (hasReply) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

export function bonDossierDebugMark(): void {
  if (!DEBUG_ENABLED) {
    return;
  }
  clearOverlays();

  document
    .querySelectorAll<HTMLElement>("shreddit-comment[author]")
    .forEach((comment, i) => {
      drawBox(comment, `C${i} shreddit-comment`, COLORS.comment);

      const body = comment.querySelector<HTMLElement>('[slot="comment"]');
      if (body) {
        drawBox(body, `C${i} body`, COLORS.body);
      }

      const meta = comment.querySelector<HTMLElement>('[slot="commentMeta"]');
      if (meta) {
        drawBox(meta, `C${i} commentMeta (author)`, COLORS.meta);
      }

      const anchor = findShareAnchor(comment);
      if (anchor) {
        drawBox(anchor, `C${i} SHARE-ANCHOR (insertAfter)`, COLORS.shareAnchor);
        const parent = anchor.parentElement;
        if (parent) {
          drawBox(parent, `C${i} parent (flex row)`, COLORS.parent);
        }
        injectDebugPill(anchor, `C${i} INNER`);

        // Try to find the outer action row using either the raw share button
        // OR our anchor (which already accounts for the fallback selector).
        const shareButton =
          comment.querySelector<HTMLElement>(
            'button[aria-label="Share"], a[aria-label="Share"]'
          ) || anchor;
        const outer = findOuterActionRow(comment, shareButton);
        if (outer) {
          drawBox(outer, `C${i} OUTER ROW (append-here)`, "#00ffff");
          const outerPill = document.createElement("span");
          outerPill.className = "bon-debug-pill";
          outerPill.textContent = `[C${i} OUTER]`;
          outerPill.style.cssText = [
            "display: inline-flex",
            "align-items: center",
            "margin: 0 0 0 0.4em",
            "padding: 0.3em 0.7em",
            "background: #00ffff",
            "color: #000",
            "font-size: 0.72em",
            "font-weight: 700",
            "font-family: monospace",
            "border: 2px solid #000",
            "border-radius: 999px",
            "vertical-align: middle",
            "line-height: 1.2",
          ].join(";");
          outer.appendChild(outerPill);
        }

        // ABS pill: position fixed (not absolute, so it survives any
        // transformed ancestor) and anchored to the action row's viewport
        // rect. Appended to document.body, bypassing Reddit's component
        // tree entirely. If THIS doesn't show up, the debug pass itself
        // isn't running for comments and we have a totally different bug.
        const rowRect = (
          outer ||
          anchor.parentElement ||
          anchor
        )?.getBoundingClientRect();
        if (rowRect) {
          const absPill = document.createElement("div");
          absPill.className = "bon-debug-pill";
          absPill.textContent = `★ C${i} ABS ★`;
          absPill.style.cssText = [
            "position: fixed",
            `top: ${rowRect.top}px`,
            `left: ${Math.min(rowRect.right + 6, window.innerWidth - 120)}px`,
            "padding: 4px 8px",
            "background: #ffeb3b",
            "color: #000",
            "font-size: 13px",
            "font-weight: 900",
            "font-family: monospace",
            "border: 3px solid #000",
            "border-radius: 4px",
            "z-index: 2147483646",
            "pointer-events: none",
            "white-space: nowrap",
            "box-shadow: 0 0 0 2px #ffeb3b, 0 0 10px rgba(0,0,0,0.8)",
          ].join(";");
          document.body.appendChild(absPill);
          console.log(
            `[Bot or Not] ABS pill C${i} placed: top=${rowRect.top} ` +
              `left=${rowRect.right + 6} viewport=${window.innerWidth}x${window.innerHeight} ` +
              `outerFound=${!!outer}`
          );
        } else {
          console.log(`[Bot or Not] C${i} no rowRect available for ABS pill`);
        }
      } else {
        drawBox(comment, `C${i} NO SHARE ANCHOR FOUND`, COLORS.notFound);
      }
    });

  document
    .querySelectorAll<HTMLElement>("shreddit-post[author]")
    .forEach((post, i) => {
      drawBox(post, `P${i} shreddit-post`, COLORS.post);

      const titleElement = post.querySelector<HTMLElement>('[slot="title"]');
      if (titleElement) {
        drawBox(titleElement, `P${i} title`, COLORS.meta);
      }
      const body = post.querySelector<HTMLElement>('[slot="text-body"]');
      if (body) {
        drawBox(body, `P${i} body`, COLORS.body);
      }

      const shareWrapper = post.querySelector<HTMLElement>(
        'faceplate-dropdown-menu[slot="ssr-share-button"]'
      );
      if (shareWrapper) {
        drawBox(
          shareWrapper,
          `P${i} SHARE-ANCHOR (insertAfter)`,
          COLORS.shareAnchor
        );
        // Mirror real injection: clone our slot attribute too so we land in
        // the same shadow-DOM slot.
        const pill = document.createElement("span");
        pill.className = "bon-debug-pill";
        pill.setAttribute("slot", "ssr-share-button");
        pill.textContent = `[P${i} PILL HERE]`;
        pill.style.cssText = [
          "display: inline-flex",
          "align-items: center",
          "margin: 0 0 0 0.4em",
          "padding: 0.3em 0.7em",
          "background: #ff00ff",
          "color: #fff",
          "font-size: 0.78em",
          "font-weight: 700",
          "font-family: monospace",
          "border: 2px solid #fff",
          "border-radius: 999px",
        ].join(";");
        shareWrapper.insertAdjacentElement("afterend", pill);
      } else {
        const fallback = findShareAnchor(post);
        if (fallback) {
          drawBox(fallback, `P${i} fallback-share`, COLORS.shareAnchor);
        } else {
          drawBox(post, `P${i} NO SHARE ANCHOR FOUND`, COLORS.notFound);
        }
      }
    });
}
