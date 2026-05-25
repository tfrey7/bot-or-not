// Pagination footer. Renders Prev / status / Next controls and a
// "showing X–Y of Z" caption. The caller decides when to render it
// (typically hidden when only one page) and owns the current page state.

export interface PaginationOpts {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function pagination(opts: PaginationOpts): HTMLElement {
  const { currentPage, totalPages, totalItems, pageSize, onPageChange } = opts;

  const wrap = document.createElement("div");
  wrap.className = "bon-pagination";

  const firstIndex = (currentPage - 1) * pageSize + 1;
  const lastIndex = Math.min(currentPage * pageSize, totalItems);

  const caption = document.createElement("span");
  caption.className = "bon-pagination-caption";
  caption.textContent = `${firstIndex}–${lastIndex} of ${totalItems}`;
  wrap.appendChild(caption);

  const controls = document.createElement("div");
  controls.className = "bon-pagination-controls";

  const first = document.createElement("button");
  first.type = "button";
  first.className = "bon-btn bon-pagination-btn";
  first.textContent = "«";
  first.title = "First page";
  first.disabled = currentPage <= 1;
  first.addEventListener("click", () => onPageChange(1));
  controls.appendChild(first);

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "bon-btn bon-pagination-btn";
  prev.textContent = "‹";
  prev.title = "Previous page";
  prev.disabled = currentPage <= 1;
  prev.addEventListener("click", () => onPageChange(currentPage - 1));
  controls.appendChild(prev);

  const status = document.createElement("span");
  status.className = "bon-pagination-status";
  status.textContent = `Page ${currentPage} of ${totalPages}`;
  controls.appendChild(status);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "bon-btn bon-pagination-btn";
  next.textContent = "›";
  next.title = "Next page";
  next.disabled = currentPage >= totalPages;
  next.addEventListener("click", () => onPageChange(currentPage + 1));
  controls.appendChild(next);

  const last = document.createElement("button");
  last.type = "button";
  last.className = "bon-btn bon-pagination-btn";
  last.textContent = "»";
  last.title = "Last page";
  last.disabled = currentPage >= totalPages;
  last.addEventListener("click", () => onPageChange(totalPages));
  controls.appendChild(last);

  wrap.appendChild(controls);

  return wrap;
}
