// Google-harvest feature — captures Reddit hits from a user-launched
// "<username> site:reddit.com" Google search and feeds them into the
// per-user Report record. Two consumer contexts:
//
//   - The Google content script (search_listener.ts, wired in
//     manifest.json) runs on google.com/search and posts findings to
//     the background.
//   - src/background.ts merges those findings into existing reports and
//     drains the queued attribution events.
//
// This index re-exports only — no top-level side effects, so it's safe
// to import from any runtime context.

export { googleAttributionDrain } from "./attribution.ts";

export { googleHarvestMerge } from "./merge.ts";

export type { ScrapedPost } from "./parse.ts";

export {
  googleHarvestIsGranted,
  googleHarvestRequest,
  googleHarvestRevoke,
  googleHarvestMatches,
} from "./permission.ts";
