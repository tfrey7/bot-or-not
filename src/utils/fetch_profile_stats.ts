// Lazily fetches /about.json the first time we see a report for a profile
// without stored cake day or karma. Fire-and-forget — callers don't depend
// on the result for first render. Karma is refreshed on each call; cake day
// is immutable so the background keeps whatever it already has.

import { clientSend } from "../client.ts";

export async function fetchAndStoreProfileStats(
  username: string
): Promise<void> {
  try {
    const response = await fetch(
      `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`,
      { credentials: "same-origin" }
    );

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as {
      data?: { created_utc?: number; total_karma?: number };
    };
    const createdUtc = data?.data?.created_utc;
    const totalKarma = data?.data?.total_karma;

    if (typeof createdUtc !== "number" && typeof totalKarma !== "number") {
      return;
    }

    void clientSend({
      type: "update-user-profile-stats",
      username,
      createdAt:
        typeof createdUtc === "number" ? Math.floor(createdUtc * 1000) : null,
      totalKarma: typeof totalKarma === "number" ? totalKarma : null,
    });
  } catch (error) {
    console.error("[Bot or Not] failed to fetch profile stats", error);
  }
}
