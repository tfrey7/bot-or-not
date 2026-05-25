// The "effectively hidden" threshold for a Reddit account, mirroring the
// definition in features/investigation/prompt.md → "Hidden profile
// handling": fewer than a handful of visible items despite enough karma
// that something *should* be visible. Centralized here so the
// investigation pipeline (which sets report.profileHidden) and the
// passive-harvest content script (which gates its DOM scan on the same
// flag) can't drift from the prompt's definition.

const HIDDEN_MAX_VISIBLE_ITEMS = 5;
const HIDDEN_MIN_KARMA = 1000;

export function isProfileHidden(args: {
  postsFetched: number;
  commentsFetched: number;
  totalKarma: number | null;
}): boolean {
  const visibleItems = args.postsFetched + args.commentsFetched;
  const karma = args.totalKarma ?? 0;

  return visibleItems <= HIDDEN_MAX_VISIBLE_ITEMS && karma >= HIDDEN_MIN_KARMA;
}
