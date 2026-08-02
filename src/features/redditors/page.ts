// Reports-page orchestrator. Mounts the Redditors tab component into the
// split container and owns the page-level chrome around it: tab activation,
// the heavy-tab render path with its shared full-reports cache, settings,
// sync, PII blur, and the sticky-shell measurement.
//
// Entry point: redditorsRenderReportsPage() — called once from
// src/reports.ts when the page loads.

import { clientSend, clientSubscribe } from "../../client.ts";
import { renderAnalyticsLoading, renderAnalyticsTab } from "../analytics";
import {
  renderReportedPostsTab,
  type ReportedHistorySlice,
} from "../reported-posts";
import { subredditsMountTab } from "../subreddits";
import { renderSync } from "../sync";
import type { Report } from "../../types.ts";
import { piiBlurInit } from "../../utils/pii_blur.ts";
import {
  pageInitConfirmModal,
  pageInitSearchBar,
  pageInitTabs,
  pageInstallDevBadge,
  type PageTab,
} from "../page";
import {
  settingsInit,
  settingsRefreshApiKeyStatus,
  settingsStrip,
} from "../settings";
import type { ReportRow } from "./logic.ts";
import { redditorsMountTab } from "./tab.tsx";

export async function redditorsRenderReportsPage(): Promise<void> {
  const splitEl = document.getElementById("bon-split") as HTMLElement;
  const analyticsContainer = document.getElementById(
    "bon-analytics-container"
  ) as HTMLElement | null;
  const subredditsSplitEl = document.getElementById(
    "bon-subreddits-split"
  ) as HTMLElement | null;
  const reportedContainer = document.getElementById(
    "bon-reported-container"
  ) as HTMLElement | null;
  const settingsStripContainer = document.getElementById(
    "bon-settings-strip"
  ) as HTMLElement | null;
  const syncContainer = document.getElementById(
    "bon-sync-container"
  ) as HTMLElement | null;

  // Vite inlines import.meta.env.DEV at build time, so the suffix only ships
  // in `vite dev` builds — published AMO builds (vite build) get a clean
  // version string.
  const versionEl = document.getElementById("bon-version");
  if (versionEl) {
    const version = browser.runtime.getManifest().version;
    versionEl.textContent = import.meta.env.DEV ? `${version} (dev)` : version;
  }

  pageInstallDevBadge();

  // The heavy tabs run off the full records (activity dumps, factor prose,
  // run snapshots), fetched separately from the tab's slim summaries and
  // cached here — refreshed only when their tab is shown or the data
  // structurally changes.
  let fullReports: ReportRow[] | null = null;
  let fullReportsDirty = true;

  // The metrics tab reads only run history and verdict fields, so it gets
  // its own slim fetch — ~10× fewer bytes across the message boundary than
  // the full records the other heavy tabs need.
  let analyticsReports: ReportRow[] | null = null;
  let analyticsReportsDirty = true;

  // The Reported tab reads only usernames + report history — its own slim
  // fetch, like the metrics tab's, instead of the full records.
  let reportedReports: ReportedHistorySlice[] | null = null;
  let reportedReportsDirty = true;

  const tab = redditorsMountTab(splitEl, {
    onStructuralChange: () => {
      fullReportsDirty = true;
      analyticsReportsDirty = true;
      reportedReportsDirty = true;
      void renderHeavyTab(tabs.current());
    },
  });

  const tabs = pageInitTabs({
    onActivate: (target) => {
      void renderHeavyTab(target);
    },
  });

  pageInitConfirmModal({
    onConfirm: () => {
      void tab.reload();
    },
  });

  pageInitSearchBar({
    input: document.getElementById("bon-search") as HTMLInputElement,
    suggestionsEl: document.getElementById(
      "bon-search-suggestions"
    ) as HTMLElement,
    getUsernames: () => tab.getReportUsernames(),
    onNavigateToUser: navigateToUser,
  });

  settingsInit();
  void piiBlurInit();
  renderSync(syncContainer);

  clientSubscribe((event) => {
    if (event.type === "api-key-changed") {
      void settingsRefreshApiKeyStatus();
    }
  });

  function navigateToUser(username: string): void {
    tabs.activate("redditors");
    tab.navigateToUser(username);
  }

  async function ensureFullReports(): Promise<ReportRow[]> {
    if (fullReports && !fullReportsDirty) {
      return fullReports;
    }

    const { reports = {} } = await clientSend<{
      reports?: Record<string, Report>;
    }>({ type: "get-all-reports" });

    fullReports = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));
    fullReportsDirty = false;

    return fullReports;
  }

  async function ensureAnalyticsReports(): Promise<ReportRow[]> {
    if (fullReports && !fullReportsDirty) {
      return fullReports;
    }

    if (analyticsReports && !analyticsReportsDirty) {
      return analyticsReports;
    }

    const { reports = {} } = await clientSend<{
      reports?: Record<string, Report>;
    }>({ type: "get-analytics-reports" });

    analyticsReports = Object.entries(reports).map(([username, data]) => ({
      username,
      ...data,
    }));
    analyticsReportsDirty = false;

    return analyticsReports;
  }

  async function ensureReportedReports(): Promise<ReportedHistorySlice[]> {
    if (fullReports && !fullReportsDirty) {
      return fullReports;
    }

    if (reportedReports && !reportedReportsDirty) {
      return reportedReports;
    }

    const { reports = [] } = await clientSend<{
      reports?: ReportedHistorySlice[];
    }>({ type: "get-reported-history" });

    reportedReports = reports;
    reportedReportsDirty = false;

    return reportedReports;
  }

  // Render one tab's content on demand. The Redditors component is always
  // live off the summary path; every other tab is painted only while it's
  // the one on screen, so hundreds of records don't get projected into
  // charts/scatter/SVG on every poll tick behind a hidden panel.
  async function renderHeavyTab(target: PageTab): Promise<void> {
    if (target === "metrics") {
      if (analyticsContainer && analyticsContainer.childElementCount === 0) {
        renderAnalyticsLoading(analyticsContainer);
      }

      const reports = await ensureAnalyticsReports();
      renderAnalyticsTab(reports, analyticsContainer);
      return;
    }

    if (target === "reported") {
      const reports = await ensureReportedReports();
      renderReportedPostsTab(reports, reportedContainer, {
        onSelectUser: navigateToUser,
      });

      return;
    }

    if (target === "settings") {
      const reports = await ensureFullReports();
      if (settingsStripContainer) {
        settingsStrip(reports, settingsStripContainer);
      }

      return;
    }

    if (target === "subreddits") {
      // Mount-once: the Preact component fetches its own data and keeps
      // itself fresh via clientSubscribe. Repeat activations are no-ops.
      subredditsMountTab(subredditsSplitEl, { onSelectUser: navigateToUser });
    }
  }

  initStickyShellMeasurement();
}

// Publish the sticky header+tabs block's measured height as a CSS variable
// so .bon-split-detail can pin itself flush against the bottom of the sticky
// shell. The shell's height varies — it grows when the header wraps at
// narrow widths — so observe rather than measure once.
function initStickyShellMeasurement(): void {
  const shell = document.querySelector<HTMLElement>(".bon-sticky-shell");
  if (!shell) {
    return;
  }

  const publish = (): void => {
    document.documentElement.style.setProperty(
      "--bon-sticky-shell-height",
      `${shell.offsetHeight}px`
    );
  };

  publish();
  new ResizeObserver(publish).observe(shell);
}
