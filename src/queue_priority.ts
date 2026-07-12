// Shared priority levels for the two p-queues that gate investigation
// work: the investigation dispatcher (features/investigation/handlers.ts)
// and the Reddit HTTP client (reddit/client.ts). p-queue runs higher
// numbers first and defaults to 0, so `bulk` work yields to `interactive`.
//
// Priority only reorders *queued* tasks — it never preempts one already
// running. So an interactive investigation jumps ahead of a subreddit
// sweep's pending users, but still waits for a concurrency slot to free.
//
//   interactive — a manually launched investigation, or fleshing out the
//     profile the operator is looking at right now. Must not sit behind a
//     ~100-user subreddit sweep.
//   bulk — a subreddit analysis enqueuing ~100 users, orphan re-sweeps on
//     startup, and background harvest trickle.
//   background — the weekly account-status re-check (features/status-recheck),
//     the daily blocklist cleanup (features/blocklist-cleanup), and the
//     harvest attribution drain. The Reddit client routes this tier through
//     its own trickle queue (one request per interval, pauses first when the
//     rate budget runs low), so it never competes with a real investigation.
export const QUEUE_PRIORITY = {
  interactive: 1,
  bulk: 0,
  background: -1,
} as const;
