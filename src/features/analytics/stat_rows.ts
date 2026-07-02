// Label/value definition-list rows used by the background-sweep cards.

export function analyticsStatRows(
  rows: Array<[string, string]>
): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "bon-sweep-rows";

  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    list.appendChild(term);

    const detail = document.createElement("dd");
    detail.textContent = value;
    list.appendChild(detail);
  }

  return list;
}
