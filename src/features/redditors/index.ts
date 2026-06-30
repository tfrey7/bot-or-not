// Redditors feature — the per-user dossier table on the reports page,
// plus all background-context handlers that own storage I/O for Report
// records. Two consumer contexts share the same public surface:
//
//   - src/reports.ts calls redditorsRenderReportsPage() to mount the UI.
//   - src/background.ts wires the redditors* handlers into the
//     message dispatcher.
//
// This index re-exports only; it has no top-level side effects so it's
// safe to import from any runtime context (service worker included).

export { redditorsRenderReportsPage } from "./page.ts";

export {
  redditorsRecordReport,
  redditorsGetState,
  redditorsGetReport,
  redditorsGetSummaries,
  redditorsGetTags,
  redditorsGetAll,
  redditorsClearAll,
  redditorsDelete,
  redditorsSetUserStatus,
  redditorsUpdateProfileStats,
  redditorsUpdatePostStatus,
  redditorsSetUserNotes,
  redditorsSetGoogleHarvest,
  redditorsSetBotBouncerStatus,
  redditorsLinkRing,
  redditorsUnlinkRing,
} from "./handlers.ts";

export { redditorsComputeRegionForReport } from "./region.ts";

export { redditorsGoogleDossierSection } from "./google_dossier_section.ts";

export type { ReportRow } from "./logic.ts";
