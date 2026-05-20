// Content-script orchestrator. Each feature owns its own init + tick
// functions; this file wires them up, then runs a single shared
// MutationObserver that fans the work out so we don't pay 4× the cost of
// independent observers on document.body.

import {
  bonInlineTagsInit,
  bonInlineTagsMark,
  bonInlineTagsResetNav,
} from "./features/inline-tags";
import {
  bonProfileInjectionInit,
  bonProfileInjectionTick,
} from "./features/profile-injection";
import { bonReportingInit, bonReportingResetNav } from "./features/reporting";
import {
  bonStatusDetectionInit,
  bonStatusDetectionResetNav,
  bonStatusDetectionScan,
} from "./features/status-detection";

const { version } = browser.runtime.getManifest();
console.log(`[Bot or Not] v${version} loaded`);

bonInlineTagsInit();
bonProfileInjectionInit();
bonReportingInit();
bonStatusDetectionInit();

// Coalesce scan work to one execution per animation frame. Reddit's SPA
// can fire hundreds of mutations per second while mounting big comment
// trees (e.g. WSB megathreads); without throttling we'd run every scan
// for every mutation and freeze the page.
let lastUrl = window.location.href;
let scanScheduled = false;

function scheduleScan(): void {
  if (scanScheduled) {
    return;
  }

  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    bonInlineTagsMark();
    bonProfileInjectionTick();
    bonStatusDetectionScan();
  });
}

const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    bonReportingResetNav();
    bonStatusDetectionResetNav();
    bonInlineTagsResetNav();
  }

  scheduleScan();
});
observer.observe(document.body, { childList: true, subtree: true });
