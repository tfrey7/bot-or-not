// Fetches a single Reddit permalink and trims it into a ContextItem the
// investigation prompt can consume. Permalinks normalize to /r/<sub>/comments/
// <postId>/<slug>/ for posts and ...<commentId>/ for comments. The .json
// endpoint returns [postListing, commentListing] for both kinds — for a comment
// permalink the targeted comment shows up as commentListing[0].data.children[0].

import type { ContextItem } from "../../types.ts";
import { bonFetchJson } from "../investigation/fetch.ts";

const BON_DOSSIER_BODY_MAX = 800;

interface RedditPostData {
  id?: string;
  author?: string;
  subreddit?: string;
  subreddit_name_prefixed?: string;
  title?: string;
  selftext?: string;
  body?: string;
  score?: number;
  created_utc?: number;
  permalink?: string;
}

type PermalinkListing = {
  data?: { children?: Array<{ kind?: string; data?: RedditPostData }> };
};

export function bonNormalizePermalink(permalink: string): string {
  let path = permalink.trim();
  if (path.startsWith("http")) {
    try {
      path = new URL(path).pathname;
    } catch {
      // fall through and treat the raw string as a path
    }
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

// Comment permalinks have an extra path segment beyond the post slug:
//   /r/sub/comments/<postId>/<slug>/<commentId>
function isCommentPermalink(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  // [r, sub, comments, postId, slug, commentId]
  return parts.length >= 6 && parts[2] === "comments";
}

export async function bonFetchContextItem(
  permalink: string,
  provenance: "auto" | "manual"
): Promise<ContextItem> {
  const path = bonNormalizePermalink(permalink);
  const url = `https://www.reddit.com${path}.json?raw_json=1&limit=1`;
  const json = (await bonFetchJson<PermalinkListing[]>(
    url
  )) as PermalinkListing[];

  const isComment = isCommentPermalink(path);
  const targetListing = isComment ? json?.[1] : json?.[0];
  const data = targetListing?.data?.children?.[0]?.data;

  if (!data) {
    throw new Error(`No data in permalink response for ${path}`);
  }

  const subreddit =
    data.subreddit_name_prefixed ??
    (data.subreddit ? `r/${data.subreddit}` : null);
  const body = (isComment ? data.body : data.selftext) ?? "";

  return {
    permalink: path,
    kind: isComment ? "comment" : "post",
    subreddit,
    author: data.author ?? "",
    title: isComment ? null : (data.title ?? null),
    body: body ? body.slice(0, BON_DOSSIER_BODY_MAX) : null,
    score: typeof data.score === "number" ? data.score : null,
    createdAt: data.created_utc
      ? new Date(data.created_utc * 1000).toISOString()
      : null,
    addedAt: Date.now(),
    provenance,
  };
}
