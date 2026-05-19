// Recent investigation failures — username, message, when. Empty section if
// nothing has failed.

import { bonFormatDate } from "../../utils/format_time.ts";
import type { ErrorRow } from "./logic.ts";

export function bonDiagnosticsErrorList(
  errors: ErrorRow[]
): HTMLDivElement | null {
  if (errors.length === 0) {
    return null;
  }

  const card = document.createElement("div");
  card.className = "bon-diag-section";

  const heading = document.createElement("p");
  heading.className = "bon-diag-section-title";
  heading.textContent = `Recent errors (${errors.length})`;
  card.appendChild(heading);

  const table = document.createElement("table");
  table.className = "bon-diag-error-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const label of ["User", "When", "Message"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }

  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");

  for (const row of errors) {
    const tr = document.createElement("tr");

    const userCell = document.createElement("td");
    userCell.className = "bon-diag-error-user";
    userCell.textContent = `u/${row.username}`;
    tr.appendChild(userCell);

    const whenCell = document.createElement("td");
    whenCell.className = "bon-diag-error-when";
    whenCell.textContent = row.runAt ? bonFormatDate(row.runAt) : "—";
    tr.appendChild(whenCell);

    const msgCell = document.createElement("td");
    msgCell.className = "bon-diag-error-msg";
    msgCell.textContent = row.message;
    tr.appendChild(msgCell);

    body.appendChild(tr);
  }

  table.appendChild(body);

  card.appendChild(table);
  return card;
}
