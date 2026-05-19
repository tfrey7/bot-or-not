// Public entry point for the web-search feature. The investigation
// pipeline calls bonWebSearchRedditUser before sending the profile to
// Claude — results get embedded in the profile summary so Claude sees
// them as plain data instead of having to use a server-side search tool.
//
// We use a fixed query shape (`site:reddit.com "<username>"`) because
// that's what surfaces the value: cached Reddit comments + sub
// participation for accounts whose post history is hidden behind the
// /user/<name>/submitted endpoint cap or the privacy toggle.

export type { WebSearchFetchResult } from "./fetch.ts";

import { bonDdgSearch, type WebSearchFetchResult } from "./fetch.ts";

export async function bonWebSearchRedditUser(
  username: string
): Promise<WebSearchFetchResult> {
  const query = `site:reddit.com "${username}"`;
  return bonDdgSearch(query);
}
