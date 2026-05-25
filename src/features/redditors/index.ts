// Redditors feature — the per-user dossier table on the reports page,
// plus all background-context handlers that own storage I/O for Report
// records. Two consumer contexts share the same public surface:
//
//   - src/reports.ts calls bonRedditorsRenderReportsPage() to mount the UI.
//   - src/background.ts wires the bonRedditors* handlers into the
//     message dispatcher.
//
// This index re-exports only; it has no top-level side effects so it's
// safe to import from any runtime context (service worker included).

export { bonRedditorsRenderReportsPage } from "./page.ts";

export {
  bonRedditorsRecordReport,
  bonRedditorsGetState,
  bonRedditorsGetReport,
  bonRedditorsGetTags,
  bonRedditorsGetAll,
  bonRedditorsClearAll,
  bonRedditorsDelete,
  bonRedditorsSetUserStatus,
  bonRedditorsUpdateProfileStats,
  bonRedditorsUpdatePostStatus,
  bonRedditorsSetUserNotes,
  bonRedditorsSetGoogleHarvest,
  bonRedditorsSetBotBouncerStatus,
  bonRedditorsLinkRing,
  bonRedditorsUnlinkRing,
} from "./handlers.ts";

export {
  bonRedditorsComputeRegionForReport,
  bonRedditorsInferTimezoneFromTimestamps,
} from "./region.ts";
export type { TimezoneInference } from "./region.ts";

export {
  bonRedditorsGoogleDossierSection,
  bonRedditorsGoogleDossierCountFresh,
} from "./google_dossier_section.ts";

export type { ReportRow } from "./logic.ts";
