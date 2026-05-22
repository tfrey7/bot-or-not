// Privacy: when the operator turns on "Blur usernames" in settings,
// usernames + avatars across the extension blur out (Discord-spoiler-style,
// reveal on hover/focus) so they can screenshot reports without exposing
// who they reported. The actual blur is pure CSS, behind a body-level
// `bon-hide-pii` class. This module wires the class to the persisted
// setting and keeps it in sync across surfaces.

import { bonClientSend, bonClientSubscribe } from "../client.ts";

const BODY_CLASS = "bon-hide-pii";

function apply(hidePii: boolean): void {
  document.body?.classList.toggle(BODY_CLASS, hidePii);
}

async function read(): Promise<boolean> {
  try {
    const { hidePii } = await bonClientSend<{ hidePii: boolean }>({
      type: "get-hide-pii",
    });

    return !!hidePii;
  } catch {
    return false;
  }
}

export async function bonPiiBlurInit(): Promise<void> {
  apply(await read());

  bonClientSubscribe((event) => {
    if (event.type !== "hide-pii-changed") {
      return;
    }

    void read().then(apply);
  });
}
