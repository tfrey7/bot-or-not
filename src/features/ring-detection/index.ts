// Ring detection — surfaces reported accounts whose subreddit-attention
// fingerprint (TF-IDF cosine over subredditCounts) overlaps a given
// user's, as candidates for manual ring linking. Two consumer contexts:
//
//   - src/background.ts wires ringDetectionGetCandidates into the
//     message dispatcher ("get-ring-candidates").
//   - the redditors detail pane renders
//     ringDetectionSimilarAccountsSection in the dossier.

export { ringDetectionGetCandidates } from "./handlers.ts";
export { ringDetectionSimilarAccountsSection } from "./similar_accounts_section.ts";
