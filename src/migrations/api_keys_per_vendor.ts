// One-time migration: split the single `claudeApiKey` slot into a
// per-vendor `apiKeys: { anthropic, openai }` map (May 2026).
//
// Old shape was Anthropic-only — the LLM module didn't have OpenAI as a
// first-class peer yet. The model-picker work made vendor a user choice,
// so we need a key per vendor (and the "do I have a key on file?" check
// needs to be answered against the *selected* vendor, not a single slot).
//
// Strategy: if `claudeApiKey` exists and `apiKeys.anthropic` doesn't,
// move the value across, then drop the old slot. Idempotent.

export async function bonMigrateApiKeysPerVendor(): Promise<void> {
  try {
    const raw = (await browser.storage.local.get([
      "claudeApiKey",
      "apiKeys",
    ])) as { claudeApiKey?: unknown; apiKeys?: unknown };

    const legacyKey =
      typeof raw.claudeApiKey === "string" ? raw.claudeApiKey : "";
    const existingMap =
      raw.apiKeys && typeof raw.apiKeys === "object"
        ? (raw.apiKeys as Record<string, unknown>)
        : null;

    if (!legacyKey) {
      // Nothing to migrate. If `claudeApiKey` is still present as an
      // empty string, sweep it.
      if (raw.claudeApiKey !== undefined) {
        await browser.storage.local.remove("claudeApiKey");
      }

      return;
    }

    const nextMap: Record<string, string> = {};

    if (existingMap) {
      for (const [vendor, value] of Object.entries(existingMap)) {
        if (typeof value === "string" && value) {
          nextMap[vendor] = value;
        }
      }
    }

    if (!nextMap.anthropic) {
      nextMap.anthropic = legacyKey;
    }

    await browser.storage.local.set({ apiKeys: nextMap });
    await browser.storage.local.remove("claudeApiKey");

    console.log("[Bot or Not] migrated claudeApiKey → apiKeys.anthropic");
  } catch (error) {
    console.error("[Bot or Not] api-keys-per-vendor migration failed", error);
  }
}
