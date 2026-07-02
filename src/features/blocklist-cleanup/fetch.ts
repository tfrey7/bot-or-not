// Reddit I/O for the blocklist cleanup sweep: reading the operator's block
// list, the identity bits the legacy write API wants, and the unblock POST
// itself — the only write the extension ever sends to Reddit.

import { QUEUE_PRIORITY } from "../../queue_priority.ts";
import { redditFetchJson, redditPostForm } from "../../reddit/client.ts";
import type { BlockedUser } from "./logic.ts";

interface UserListEnvelope {
  data?: {
    children?: Array<{ name?: string; id?: string }>;
    after?: string | null;
  };
}

// The block list is capped at 1000 and pages at 100, so a dozen pages is
// already past the cap — the loop can't run away on a cyclic cursor.
const MAX_BLOCKLIST_PAGES = 12;

export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const users: BlockedUser[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_BLOCKLIST_PAGES; page++) {
    const url = new URL("https://www.reddit.com/prefs/blocked.json");
    url.searchParams.set("limit", "100");
    if (after !== null) {
      url.searchParams.set("after", after);
    }

    const envelope = await redditFetchJson<UserListEnvelope>(
      url.toString(),
      QUEUE_PRIORITY.background
    );

    for (const child of envelope.data?.children ?? []) {
      if (typeof child.name === "string" && child.name.length > 0) {
        users.push({ username: child.name, fullname: child.id ?? null });
      }
    }

    after = envelope.data?.after ?? null;
    if (after === null) {
      break;
    }
  }

  return users;
}

export interface SelfIdentity {
  fullname: string;
  modhash: string;
}

interface MeEnvelope {
  data?: { id?: string; modhash?: string };
}

// The legacy unfriend endpoint needs the operator's own t2 fullname as the
// `container` and a modhash as CSRF proof. Null when either is unavailable
// (logged out, or Reddit stopped minting modhashes for this session) — the
// sweep then skips unblocking rather than firing doomed POSTs.
export async function fetchSelfIdentity(): Promise<SelfIdentity | null> {
  try {
    const envelope = await redditFetchJson<MeEnvelope>(
      "https://www.reddit.com/api/me.json",
      QUEUE_PRIORITY.background
    );

    if (!envelope.data?.id || !envelope.data.modhash) {
      return null;
    }

    return {
      fullname: `t2_${envelope.data.id}`,
      modhash: envelope.data.modhash,
    };
  } catch {
    return null;
  }
}

// Unblock = unfriend with type "enemy" (Reddit's original block vocabulary).
// The blocked account's own fullname rides along when we have it so the
// relationship still resolves after the username is deleted.
export async function postUnblock(
  user: BlockedUser,
  self: SelfIdentity
): Promise<void> {
  const form: Record<string, string> = {
    type: "enemy",
    name: user.username,
    container: self.fullname,
    uh: self.modhash,
  };

  if (user.fullname !== null) {
    form.id = user.fullname;
  }

  await redditPostForm(
    "https://www.reddit.com/api/unfriend",
    form,
    QUEUE_PRIORITY.background
  );
}
