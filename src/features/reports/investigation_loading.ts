// Centered Sherlock Chromes illustration shown while an investigation is
// in flight, replacing the bare "Running…" text in the detail pane.

export function bonReportsInvestigationLoading(
  startedAt: number | null | undefined,
  contextLabel: string | null
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-investigation-loading";

  const art = document.createElement("img");
  art.className = "bon-investigation-loading__art";
  art.src = browser.runtime.getURL("icons/chromes-investigating.png");
  art.alt = "Sherlock Chromes examining evidence under a desk lamp";
  art.width = 600;
  art.height = 400;
  wrap.appendChild(art);

  const caption = document.createElement("p");
  caption.className = "bon-investigation-loading__caption";
  caption.textContent = "Investigating";
  wrap.appendChild(caption);

  const parts: string[] = [];
  if (startedAt) {
    parts.push(`Started ${new Date(startedAt).toLocaleTimeString()}`);
  }
  if (contextLabel) {
    parts.push(contextLabel);
  }
  if (parts.length) {
    const meta = document.createElement("p");
    meta.className = "bon-investigation-loading__meta";
    meta.textContent = parts.join(" · ");
    wrap.appendChild(meta);
  }

  return wrap;
}
