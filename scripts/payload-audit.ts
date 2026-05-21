// Audit script: fetch one Reddit user, build the summary, then report
// exact byte / token contribution of every field type in the JSON
// payload Claude sees. No Claude call — pure inspection.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { DOMParser as LinkedomDOMParser } from "linkedom";

(globalThis as unknown as { DOMParser: typeof LinkedomDOMParser }).DOMParser =
  LinkedomDOMParser;

import { bonFetchRedditProfile } from "../src/features/investigation/fetch.ts";
import { bonSummarizeProfile } from "../src/features/investigation/summarize.ts";

const _REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const username = process.argv[2];
if (!username) {
  console.error("Usage: tsx scripts/payload-audit.ts <username>");
  process.exit(1);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes("reddit.com")) {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", "bot-or-not-cli/1.0 (payload-audit)");
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
}) as typeof fetch;

function approxTokens(bytes: number): number {
  return Math.round(bytes / 3.6);
}

async function main(): Promise<void> {
  console.log(`[audit] fetching u/${username}...`);
  const { profile } = await bonFetchRedditProfile(username);
  const summary = bonSummarizeProfile(username, profile, {});

  const fullJson = JSON.stringify(summary, null, 2);
  const compactJson = JSON.stringify(summary);

  console.log("");
  console.log("=== Top-level shape ===");
  console.log(`posts in summary:    ${summary.recent_posts.length}`);
  console.log(`comments in summary: ${summary.recent_comments.length}`);
  console.log("");
  console.log("=== Total payload (what Claude sees today) ===");
  console.log(
    `pretty-printed (null, 2): ${fullJson.length.toLocaleString()} bytes  ~${approxTokens(fullJson.length).toLocaleString()} tokens`
  );
  console.log(
    `compact (no whitespace):  ${compactJson.length.toLocaleString()} bytes  ~${approxTokens(compactJson.length).toLocaleString()} tokens  (${Math.round((1 - compactJson.length / fullJson.length) * 100)}% savings)`
  );

  console.log("");
  console.log("=== Per-post field byte cost (sum across all posts) ===");
  if (summary.recent_posts.length > 0) {
    const fieldKeys = Object.keys(summary.recent_posts[0]) as Array<
      keyof (typeof summary.recent_posts)[0]
    >;
    const fieldBytes: Record<string, number> = {};
    for (const post of summary.recent_posts) {
      for (const key of fieldKeys) {
        const value = post[key];
        if (value === null || value === undefined) {
          fieldBytes[key] = (fieldBytes[key] ?? 0) + 4; // "null"
        } else {
          fieldBytes[key] =
            (fieldBytes[key] ?? 0) + JSON.stringify(value).length;
        }
      }
    }
    const totalPostBytes = Object.values(fieldBytes).reduce(
      (a, b) => a + b,
      0
    );
    const rows = Object.entries(fieldBytes).sort((a, b) => b[1] - a[1]);
    for (const [field, bytes] of rows) {
      const pct = ((bytes / totalPostBytes) * 100).toFixed(1);
      const avg = (bytes / summary.recent_posts.length).toFixed(1);
      console.log(
        `  ${field.padEnd(22)} ${bytes.toString().padStart(8)} bytes  ${pct.padStart(5)}%  avg ${avg.padStart(6)}/post`
      );
    }
    console.log(
      `  ${"TOTAL".padEnd(22)} ${totalPostBytes.toString().padStart(8)} bytes  100.0%`
    );
  }

  console.log("");
  console.log("=== Per-comment field byte cost (sum across all comments) ===");
  if (summary.recent_comments.length > 0) {
    const fieldKeys = Object.keys(summary.recent_comments[0]) as Array<
      keyof (typeof summary.recent_comments)[0]
    >;
    const fieldBytes: Record<string, number> = {};
    for (const comment of summary.recent_comments) {
      for (const key of fieldKeys) {
        const value = comment[key];
        if (value === null || value === undefined) {
          fieldBytes[key] = (fieldBytes[key] ?? 0) + 4;
        } else {
          fieldBytes[key] =
            (fieldBytes[key] ?? 0) + JSON.stringify(value).length;
        }
      }
    }
    const total = Object.values(fieldBytes).reduce((a, b) => a + b, 0);
    const rows = Object.entries(fieldBytes).sort((a, b) => b[1] - a[1]);
    for (const [field, bytes] of rows) {
      const pct = ((bytes / total) * 100).toFixed(1);
      const avg = (bytes / summary.recent_comments.length).toFixed(1);
      console.log(
        `  ${field.padEnd(22)} ${bytes.toString().padStart(8)} bytes  ${pct.padStart(5)}%  avg ${avg.padStart(6)}/cmt`
      );
    }
    console.log(
      `  ${"TOTAL".padEnd(22)} ${total.toString().padStart(8)} bytes  100.0%`
    );
  }

  console.log("");
  console.log("=== Simulated trims (compact JSON, on this user) ===");

  const trimmedSummary = JSON.parse(JSON.stringify(summary)) as typeof summary;
  trimmedSummary.recent_posts = trimmedSummary.recent_posts.map((p) => {
    const x = { ...p } as Partial<typeof p>;
    delete x.url;
    delete x.permalink;
    delete x.is_self;
    delete x.over_18;
    if (p.removed_by_category === null) delete x.removed_by_category;
    return x as typeof p;
  });
  trimmedSummary.recent_comments = trimmedSummary.recent_comments.map((c) => {
    const x = { ...c } as Partial<typeof c>;
    delete x.permalink;
    if (c.removed_by_category === null) delete x.removed_by_category;
    return x as typeof c;
  });

  const trimmedJson = JSON.stringify(trimmedSummary);
  console.log(
    `current compact:                       ${compactJson.length.toLocaleString()} bytes  ~${approxTokens(compactJson.length).toLocaleString()} tokens`
  );
  console.log(
    `drop url/permalink/is_self/over_18:    ${trimmedJson.length.toLocaleString()} bytes  ~${approxTokens(trimmedJson.length).toLocaleString()} tokens  (${Math.round((1 - trimmedJson.length / compactJson.length) * 100)}% less)`
  );

  // Convert timestamps to epoch seconds (10 chars vs 24)
  const tightSummary = JSON.parse(JSON.stringify(trimmedSummary)) as typeof summary;
  tightSummary.recent_posts = tightSummary.recent_posts.map((p) => ({
    ...p,
    created_at: p.created_at
      ? String(Math.floor(new Date(p.created_at).getTime() / 1000))
      : null,
  })) as typeof tightSummary.recent_posts;
  tightSummary.recent_comments = tightSummary.recent_comments.map((c) => ({
    ...c,
    created_at: c.created_at
      ? String(Math.floor(new Date(c.created_at).getTime() / 1000))
      : null,
  })) as typeof tightSummary.recent_comments;

  const tightJson = JSON.stringify(tightSummary);
  console.log(
    `also: epoch-second timestamps:         ${tightJson.length.toLocaleString()} bytes  ~${approxTokens(tightJson.length).toLocaleString()} tokens  (${Math.round((1 - tightJson.length / compactJson.length) * 100)}% less overall)`
  );

  // Also drop title from comments' link_title (only useful for context)
  const tighterSummary = JSON.parse(JSON.stringify(tightSummary)) as typeof summary;
  tighterSummary.recent_comments = tighterSummary.recent_comments.map(
    (c) => {
      const x = { ...c } as Partial<typeof c>;
      delete x.link_title;
      return x as typeof c;
    }
  );
  const tighterJson = JSON.stringify(tighterSummary);
  console.log(
    `also: drop link_title from comments:   ${tighterJson.length.toLocaleString()} bytes  ~${approxTokens(tighterJson.length).toLocaleString()} tokens  (${Math.round((1 - tighterJson.length / compactJson.length) * 100)}% less overall)`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
