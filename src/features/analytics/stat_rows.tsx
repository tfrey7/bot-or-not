// Label/value definition-list rows used by the background-sweep cards.

import { Fragment } from "preact";
import type { ComponentChildren } from "preact";

export function StatRows({
  rows,
}: {
  rows: Array<[string, ComponentChildren]>;
}) {
  return (
    <dl class="bon-sweep-rows">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
