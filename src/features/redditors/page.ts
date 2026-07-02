// Reports-page orchestrator. Mounts the Redditors tab component into the
// split container and owns the page-level chrome around it: tab activation,
// the heavy-tab render path with its shared full-reports cache, settings,
// sync, PII blur, and the sticky-shell measurement.
//
// Entry point: redditorsRenderReportsPage() — called once from
// src/reports.ts when the page loads.

import { clientSend, clientSubscribe } from "../../client.ts";
import { renderAnalyticsTab } from "../analytics";
import { renderFieldGuideTab, renderPersonasTab } from "../personas";
import { subredditsMountTab } from "../subreddits";
import { renderSync } from "../sync";
import type { Report } from "../../types.ts";
import { piiBlurInit } from "../../utils/pii_blur.ts";
import {
  pageInitConfirmModal,
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
  const personasContainer = document.getElementById(
    "bon-personas-container"
  ) as HTMLElement | null;
  const fieldGuideContainer = document.getElementById(
    "bon-fieldguide-container"
  ) as HTMLElement | null;
  const subredditsSplitEl = document.getElementById(
    "bon-subreddits-split"
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

  const tab = redditorsMountTab(splitEl, {
    onStructuralChange: () => {
      fullReportsDirty = true;
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

  // Render one tab's content on demand. The Redditors component is always
  // live off the summary path; every other tab is painted only while it's
  // the one on screen, so hundreds of records don't get projected into
  // charts/scatter/SVG on every poll tick behind a hidden panel.
  async function renderHeavyTab(target: PageTab): Promise<void> {
    if (target === "metrics") {
      const reports = await ensureFullReports();
      renderAnalyticsTab(reports, analyticsContainer);
      return;
    }

    if (target === "personas") {
      const reports = await ensureFullReports();
      renderPersonasTab(reports, personasContainer, {
        onSelectUser: navigateToUser,
      });

      return;
    }

    if (target === "fieldguide") {
      const reports = await ensureFullReports();
      renderFieldGuideTab(reports, fieldGuideContainer, {
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
// shell. The shell's height varies — it grows when the command status line
// appears and when the header wraps at narrow widths — so observe rather
// than measure once.
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
