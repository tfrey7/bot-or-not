// Pure suggestion ranking for the header user search. No DOM — the widget
// (search_bar.ts) renders whatever this returns.

export type PageSearchSuggestion =
  | { kind: "user"; username: string }
  | { kind: "investigate"; username: string };

const SEARCH_MAX_USER_SUGGESTIONS = 8;

const REDDIT_USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

export function pageSearchSuggestions(
  rawQuery: string,
  usernames: string[]
): PageSearchSuggestion[] {
  const typed = rawQuery.trim().replace(/^\/?u\//i, "");
  const query = typed.toLowerCase();

  if (!query) {
    return [];
  }

  const prefixMatches: string[] = [];
  const substringMatches: string[] = [];

  for (const username of usernames) {
    const lower = username.toLowerCase();

    if (lower.startsWith(query)) {
      prefixMatches.push(username);
    } else if (lower.includes(query)) {
      substringMatches.push(username);
    }
  }

  const byName = (a: string, b: string): number =>
    a.toLowerCase().localeCompare(b.toLowerCase());
  prefixMatches.sort(byName);
  substringMatches.sort(byName);

  const matches = [...prefixMatches, ...substringMatches].slice(
    0,
    SEARCH_MAX_USER_SUGGESTIONS
  );

  const suggestions: PageSearchSuggestion[] = matches.map((username) => ({
    kind: "user",
    username,
  }));

  const hasExactMatch = matches.some(
    (username) => username.toLowerCase() === query
  );

  if (!hasExactMatch && REDDIT_USERNAME_RE.test(typed)) {
    suggestions.push({ kind: "investigate", username: typed });
  }

  return suggestions;
}
