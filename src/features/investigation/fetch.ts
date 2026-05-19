// Reddit fetch primitives used by the investigation pipeline. All four
// JSON endpoints (about, submitted, comments, moderated) are fetched in
// parallel so a single investigation pays one round-trip latency, not
// four. The BotBouncer lookup is a separate active query so the AI sees
// that signal even when the user hasn't browsed an r/BotBouncer post
// recently (which is what the content script's passive detector needs).

import type {
  BotBouncerStatus,
  RedditActivityFetch,
  RedditProfile,
} from "../../types.ts";
import { bonShortUrl } from "../../utils/format_text.ts";

export const BON_REDDIT_FETCH_LIMIT = 100;

export async function bonTimed<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();

  try {
    const result = await task();
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms`);
    return result;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`[Bot or Not] timing: ${label} ${elapsedMs}ms (failed)`);
    throw error;
  }
}

export async function bonFetchJson<T = unknown>(url: string): Promise<T> {
  return bonTimed(`fetch ${bonShortUrl(url)}`, async () => {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Reddit fetch ${response.status} for ${url}`);
    }

    return response.json() as Promise<T>;
  });
}

interface BotBouncerPost {
  title?: string;
  link_flair_text?: string;
}

interface BotBouncerSearchResponse {
  data?: {
    children?: Array<{ data?: BotBouncerPost }>;
  };
}

export async function bonFetchBotBouncerStatus(
  username: string
): Promise<BotBouncerStatus> {
  const query = encodeURIComponent(`Overview for ${username}`);
  const url = `https://www.reddit.com/r/BotBouncer/search.json?q=${query}&restrict_sr=true&sort=new&limit=10&raw_json=1`;

  try {
    const searchResponse = await bonFetchJson<BotBouncerSearchResponse>(url);
    const target = `overview for ${username}`.toLowerCase();

    for (const child of searchResponse.data?.children ?? []) {
      const post = child.data;
      if (!post) {
        continue;
      }
      if ((post.title ?? "").toLowerCase().trim() !== target) {
        continue;
      }
      const flair = (post.link_flair_text ?? "").toLowerCase().trim();
      if (flair === "banned" || flair === "pending" || flair === "organic") {
        return flair;
      }
      return null;
    }

    return null;
  } catch (error) {
    console.error("[Bot or Not] BotBouncer lookup failed", error);
    return null;
  }
}

export async function bonFetchRedditProfile(
  username: string
): Promise<RedditProfile> {
  const encodedUsername = encodeURIComponent(username);
  const [about, submitted, comments, moderated] = await Promise.all([
    bonFetchJson(`https://www.reddit.com/user/${encodedUsername}/about.json`),
    bonFetchJson(
      `https://www.reddit.com/user/${encodedUsername}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${encodedUsername}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${encodedUsername}/moderated_subreddits.json?raw_json=1`
    ).catch(() => null),
  ]);

  return {
    about: about as RedditProfile["about"],
    submitted: submitted as RedditProfile["submitted"],
    comments: comments as RedditProfile["comments"],
    moderated: moderated as RedditProfile["moderated"],
  };
}

// Lighter fetch used by the "load activity" button on the reports page —
// skips the about endpoint since we only need posts + comments + mod list
// to feed the activity heatmap and region inference.
export async function bonFetchRedditActivity(
  username: string
): Promise<RedditActivityFetch> {
  const encodedUsername = encodeURIComponent(username);
  const [submitted, comments, moderated] = await Promise.all([
    bonFetchJson(
      `https://www.reddit.com/user/${encodedUsername}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${encodedUsername}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${encodedUsername}/moderated_subreddits.json?raw_json=1`
    ).catch(() => null),
  ]);

  return {
    submitted: submitted as RedditActivityFetch["submitted"],
    comments: comments as RedditActivityFetch["comments"],
    moderated: moderated as RedditActivityFetch["moderated"],
  };
}
