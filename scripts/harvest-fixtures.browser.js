// Browser-console harvester for investigation fixtures. Not run directly —
// `npm run harvest` injects the username list below and copies the result
// to the clipboard for pasting into a logged-in Reddit tab's console.
//
// Why a browser console: Reddit hard-blocks unauthenticated HTTP at the
// network level (403 "blocked by network security" even for real browsers
// logged out), so the only place profile JSON is still fetchable is a
// same-origin tab riding the operator's session. Reddit's CSP also blocks
// connect-src to localhost, so delivery is a file download rather than a
// POST: everything lands in one bon-fixtures.json, which `npm run ingest`
// splits into fixtures/<username>.json.
//
// Mirrors src/features/investigation/fetch.ts: about + submitted +
// comments (paginated to 500) + moderated per user, plus the Bot Bouncer
// search. Items are slimmed to the fields the pipeline reads.

(async () => {
  const USERNAMES = /* __USERNAMES__ */ [];

  const FETCH_LIMIT = 500;
  const PAGE_LIMIT = 100;
  const BODY_CAP = 800;
  const DELAY_MS = 300;

  const log = (...parts) => console.log("[Bot or Not]", ...parts);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function getJson(path) {
    await sleep(DELAY_MS);
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`${path} -> HTTP ${response.status}`);
    }
    return response.json();
  }

  const cap = (text) =>
    typeof text === "string" ? text.slice(0, BODY_CAP) : text;

  function slimPost(data) {
    return {
      subreddit: data.subreddit,
      subreddit_name_prefixed: data.subreddit_name_prefixed,
      title: data.title,
      selftext: cap(data.selftext),
      score: data.score,
      num_comments: data.num_comments,
      created_utc: data.created_utc,
      removed_by_category: data.removed_by_category ?? null,
    };
  }

  function slimComment(data) {
    return {
      subreddit: data.subreddit,
      subreddit_name_prefixed: data.subreddit_name_prefixed,
      body: cap(data.body),
      score: data.score,
      created_utc: data.created_utc,
      link_title: data.link_title,
      removed_by_category: data.removed_by_category ?? null,
    };
  }

  function slimModerated(entry) {
    return {
      sr: entry.sr,
      sr_display_name_prefixed: entry.sr_display_name_prefixed,
      display_name: entry.display_name,
      subscribers: entry.subscribers,
      subreddit_type: entry.subreddit_type,
      over_18: entry.over_18,
      url: entry.url,
    };
  }

  async function fetchListing(pathBase, slim) {
    const children = [];
    let cursor = null;

    while (children.length < FETCH_LIMIT) {
      const pageLimit = Math.min(PAGE_LIMIT, FETCH_LIMIT - children.length);
      const after = cursor ? `&after=${encodeURIComponent(cursor)}` : "";
      const page = await getJson(
        `${pathBase}?limit=${pageLimit}${after}&raw_json=1`
      );

      const pageChildren = page.data?.children ?? [];
      for (const child of pageChildren) {
        if (child.data) {
          children.push({ data: slim(child.data) });
        }
      }

      cursor = page.data?.after ?? null;
      if (!cursor || pageChildren.length === 0) {
        break;
      }
    }

    return { data: { after: cursor, children } };
  }

  async function fetchBotBouncerStatus(username) {
    const query = encodeURIComponent(`Overview for ${username}`);
    const listing = await getJson(
      `/r/BotBouncer/search.json?q=${query}&restrict_sr=true&sort=new&limit=10&raw_json=1`
    );

    const target = `overview for ${username}`.toLowerCase();
    for (const child of listing.data?.children ?? []) {
      const post = child.data;
      if (!post || (post.title ?? "").toLowerCase().trim() !== target) {
        continue;
      }
      const flair = (post.link_flair_text ?? "").toLowerCase().trim();
      if (flair === "banned" || flair === "pending" || flair === "organic") {
        return flair;
      }
      return null;
    }
    return null;
  }

  async function harvestUser(username) {
    const encoded = encodeURIComponent(username);

    const aboutRaw = await getJson(`/user/${encoded}/about.json`);
    const a = aboutRaw.data ?? {};
    const about = {
      data: {
        name: a.name,
        created_utc: a.created_utc,
        total_karma: a.total_karma,
        link_karma: a.link_karma,
        comment_karma: a.comment_karma,
        is_employee: a.is_employee,
        verified: a.verified,
        has_verified_email: a.has_verified_email,
        snoovatar_img: a.snoovatar_img,
      },
    };

    const submitted = await fetchListing(
      `/user/${encoded}/submitted.json`,
      slimPost
    );
    const comments = await fetchListing(
      `/user/${encoded}/comments.json`,
      slimComment
    );

    let moderated = null;
    try {
      const moderatedRaw = await getJson(
        `/user/${encoded}/moderated_subreddits.json?raw_json=1`
      );
      moderated = { data: (moderatedRaw.data ?? []).map(slimModerated) };
    } catch (error) {
      log(`  moderated fetch failed for ${username} (non-fatal):`, error);
    }

    let botBouncerStatus = null;
    try {
      botBouncerStatus = await fetchBotBouncerStatus(username);
    } catch (error) {
      log(`  Bot Bouncer fetch failed for ${username} (non-fatal):`, error);
    }

    return {
      username,
      harvestedAt: new Date().toISOString(),
      botBouncerStatus,
      profile: { about, submitted, comments, moderated },
    };
  }

  const fixtures = [];

  for (const username of USERNAMES) {
    log(`Harvesting u/${username}...`);
    try {
      const fixture = await harvestUser(username);
      const posts = fixture.profile.submitted.data.children.length;
      const comments = fixture.profile.comments.data.children.length;
      log(
        `  posts=${posts} comments=${comments} botbouncer=${fixture.botBouncerStatus ?? "none"}`
      );
      fixtures.push(fixture);
    } catch (error) {
      log(`  FAILED u/${username}:`, error);
    }
  }

  const blob = new Blob([JSON.stringify(fixtures)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "bon-fixtures.json";
  document.body.appendChild(link);
  link.click();
  link.remove();

  log(
    `Done — ${fixtures.length}/${USERNAMES.length} harvested; bon-fixtures.json download triggered.`
  );
})();
