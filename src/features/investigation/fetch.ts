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
  fn: () => Promise<T>
): Promise<T> {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`[Bot or Not] timing: ${label} ${ms}ms`);
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    console.log(`[Bot or Not] timing: ${label} ${ms}ms (failed)`);
    throw err;
  }
}

export async function bonFetchJson<T = unknown>(url: string): Promise<T> {
  return bonTimed(`fetch ${bonShortUrl(url)}`, async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`Reddit fetch ${res.status} for ${url}`);
    }
    return res.json() as Promise<T>;
  });
}

export async function bonFetchBotBouncerStatus(
  username: string
): Promise<BotBouncerStatus> {
  const q = encodeURIComponent(`Overview for ${username}`);
  const url = `https://www.reddit.com/r/BotBouncer/search.json?q=${q}&restrict_sr=true&sort=new&limit=10&raw_json=1`;
  try {
    const json = await bonFetchJson<{
      data?: {
        children?: Array<{
          data?: { title?: string; link_flair_text?: string };
        }>;
      };
    }>(url);
    const posts = (json.data?.children || [])
      .map((c) => c.data)
      .filter((p): p is { title?: string; link_flair_text?: string } =>
        Boolean(p)
      );
    const target = `overview for ${username}`.toLowerCase();
    const match = posts.find(
      (p) => (p.title || "").toLowerCase().trim() === target
    );
    if (!match) {
      return null;
    }
    const flair = (match.link_flair_text || "").toLowerCase().trim();
    if (flair === "banned" || flair === "pending" || flair === "organic") {
      return flair;
    }
    return null;
  } catch (err) {
    console.error("[Bot or Not] BotBouncer lookup failed", err);
    return null;
  }
}

export async function bonFetchRedditProfile(
  username: string
): Promise<RedditProfile> {
  const safe = encodeURIComponent(username);
  const [about, submitted, comments, moderated] = await Promise.all([
    bonFetchJson(`https://www.reddit.com/user/${safe}/about.json`),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/moderated_subreddits.json?raw_json=1`
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
  const safe = encodeURIComponent(username);
  const [submitted, comments, moderated] = await Promise.all([
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/submitted.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/comments.json?limit=${BON_REDDIT_FETCH_LIMIT}&raw_json=1`
    ),
    bonFetchJson(
      `https://www.reddit.com/user/${safe}/moderated_subreddits.json?raw_json=1`
    ).catch(() => null),
  ]);
  return {
    submitted: submitted as RedditActivityFetch["submitted"],
    comments: comments as RedditActivityFetch["comments"],
    moderated: moderated as RedditActivityFetch["moderated"],
  };
}
