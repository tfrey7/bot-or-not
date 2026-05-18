// Lazily fetches the account's createdUtc the first time we see a report
// for a profile that doesn't have one stored yet. Fire-and-forget — the
// panel doesn't depend on the result for first render, and the background
// just stamps it into the report record once it lands.

export async function bonPanelFetchAndStoreCakeDay(
  username: string
): Promise<void> {
  try {
    const res = await fetch(
      `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`,
      { credentials: "same-origin" }
    );

    if (!res.ok) {
      return;
    }

    const data = (await res.json()) as { data?: { created_utc?: number } };
    const createdUtc = data?.data?.created_utc;

    if (!createdUtc) {
      return;
    }

    browser.runtime.sendMessage({
      type: "update-user-created-at",
      username,
      createdAt: Math.floor(createdUtc * 1000),
    });
  } catch (err) {
    console.error("[Bot or Not] failed to fetch cake day", err);
  }
}
