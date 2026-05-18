// Content-script orchestrator. Each feature owns its own init + tick
// functions; this file wires them up, then runs a single shared
// MutationObserver that fans the work out so we don't pay 4× the cost of
// independent observers on document.body.

import {
  bonInlineTagsInit,
  bonInlineTagsMark,
} from "./features/inline-tags/index.js";
import {
  bonProfilePanelInit,
  bonProfilePanelInject,
} from "./features/profile-panel/index.js";
import {
  bonReportingInit,
  bonReportingResetNav,
} from "./features/reporting/index.js";
import {
  bonStatusDetectionInit,
  bonStatusDetectionResetNav,
  bonStatusDetectionScan,
} from "./features/status-detection/index.js";

const { version } = browser.runtime.getManifest();
console.log(`[Bot or Not] v${version} loaded`);

bonInlineTagsInit();
bonReportingInit();
bonProfilePanelInit();
bonStatusDetectionInit();

let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    bonReportingResetNav();
    bonStatusDetectionResetNav();
  }
  bonProfilePanelInject();
  bonInlineTagsMark();
  bonStatusDetectionScan();
});
observer.observe(document.body, { childList: true, subtree: true });
