// Background-context message handlers — the reports page reads the sweep's
// bookkeeping through these instead of touching storage directly, and the
// content-script tripwire reports watchlisted accounts it sees on Reddit
// pages.

import { fetchAccountLiveness } from "../../reddit/liveness.ts";
import type { BlocklistCleanupState } from "../../storage";
import {
  readBlocklistCleanupState,
  writeBlocklistCleanupState,
} from "../../storage";
import { fetchSelfIdentity, postBlock } from "./fetch.ts";
import { sameKarma } from "./logic.ts";

// A sighting that doesn't end in a re-block (still dormant, block refused,
// transient probe failure) shouldn't re-probe on every page the account
// appears on. In-memory is fine — a worker restart just retries sooner.
const REBLOCK_ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const lastAttemptAt = new Map<string, number>();

export function blocklistCleanupGetState(): Promise<BlocklistCleanupState> {
  return readBlocklistCleanupState();
}

export async function blocklistTripwireList(): Promise<{
  usernames: string[];
}> {
  const state = await readBlocklistCleanupState();

  return { usernames: Object.keys(state.watchlist) };
}

// A watchlisted account was sighted on a Reddit page. Verify it actually
// returned to activity — karma moved since eviction — with a fresh probe
// before re-blocking; a sighting alone can just be its old content rendering
// in some feed. When eviction-time karma isn't available for comparison, the
// sighting is enough (the operator banned the account once already).
export async function blocklistReblock(
  username: string
): Promise<{ blocked: boolean }> {
  const key = username.toLowerCase();
  const state = await readBlocklistCleanupState();
  const watch = state.watchlist[key];

  if (watch === undefined) {
    return { blocked: false };
  }

  const now = Date.now();
  const lastAttempt = lastAttemptAt.get(key) ?? 0;
  if (now - lastAttempt < REBLOCK_ATTEMPT_COOLDOWN_MS) {
    return { blocked: false };
  }

  lastAttemptAt.set(key, now);

  const probe = await fetchAccountLiveness(username, "blocklist");
  if (probe === null || probe.status !== "active") {
    return { blocked: false };
  }

  if (
    watch.karma !== null &&
    probe.karma !== null &&
    sameKarma(watch.karma, probe.karma)
  ) {
    return { blocked: false };
  }

  const self = await fetchSelfIdentity();
  if (self === null) {
    return { blocked: false };
  }

  try {
    await postBlock(username, self);
  } catch (error) {
    console.warn(
      `[Bot or Not] blocklist tripwire: re-block failed for ${username}`,
      error
    );

    return { blocked: false };
  }

  const next = await readBlocklistCleanupState();
  const watchlist = { ...next.watchlist };
  delete watchlist[key];

  await writeBlocklistCleanupState({
    ...next,
    watchlist,
    reblocked: [...next.reblocked, { username, at: Date.now() }],
  });

  console.log(
    `[Bot or Not] blocklist tripwire: ${username} returned to activity — re-blocked`
  );

  return { blocked: true };
}
