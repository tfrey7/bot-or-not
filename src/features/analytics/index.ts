// Analytics feature — the metrics tab on the reports page plus the
// background handler serving its slim reports projection. Two consumer
// contexts share this surface:
//
//   - src/features/redditors/page.ts mounts the tab renderers.
//   - src/background.ts wires analyticsGetReports into the dispatcher.
//
// This index re-exports only; it has no top-level side effects so it's
// safe to import from any runtime context (service worker included).

export { renderAnalyticsLoading, renderAnalyticsTab } from "./tab.tsx";
export { analyticsGetReports } from "./handlers.ts";
