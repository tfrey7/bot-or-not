// Hosts a vanilla-built DOM node inside a Preact tree. The wrapper span is
// display: contents so it adds no box — the hosted node lays out as if it
// were a direct child of the JSX parent.

import { useEffect, useRef } from "preact/hooks";

export function Vanilla({ node }: { node: Element | null }) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (node) {
      host.current?.replaceChildren(node);
    }
  }, [node]);

  if (!node) {
    return null;
  }

  return <span style={{ display: "contents" }} ref={host} />;
}
