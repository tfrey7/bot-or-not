// Content-script orchestrator. Each feature owns its own init + tick
// functions; this file wires them up, then runs a single shared
// MutationObserver that fans the work out so we don't pay 4× the cost of
// independent observers on document.body.
//
// Everything here is gated on the Claude API key being set. Without a key
// the extension can't actually investigate anything, so showing chips and
// harvesting data would just be clutter. We stay dormant until the key
// arrives, then bring the features up live (no Reddit-tab reload needed).

import { bonClientSend, bonClientSubscribe } from "./client.ts";
import {
  bonInlineTagsInit,
  bonInlineTagsMark,
  bonInlineTagsResetNav,
} from "./features/inline-tags";
import {
  bonPassiveHarvestInit,
  bonPassiveHarvestTick,
} from "./features/passive-harvest";
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

let featuresStarted = false;
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
    bonPassiveHarvestTick();
    bonProfileInjectionTick();
    bonStatusDetectionScan();
  });
}

function startFeatures(): void {
  if (featuresStarted) {
    return;
  }

  featuresStarted = true;

  bonInlineTagsInit();
  bonPassiveHarvestInit();
  bonProfileInjectionInit();
  bonReportingInit();
  bonStatusDetectionInit();

  // Coalesce scan work to one execution per animation frame. Reddit's SPA
  // can fire hundreds of mutations per second while mounting big comment
  // trees (e.g. WSB megathreads); without throttling we'd run every scan
  // for every mutation and freeze the page.
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
}

async function hasClaudeApiKey(): Promise<boolean> {
  try {
    const { hasKey } = await bonClientSend<{ hasKey: boolean }>({
      type: "get-claude-api-key",
    });

    return !!hasKey;
  } catch (error) {
    console.error("[Bot or Not] failed to read api-key state", error);
    return false;
  }
}

async function bootstrap(): Promise<void> {
  if (await hasClaudeApiKey()) {
    startFeatures();
    return;
  }

  console.log(
    "[Bot or Not] No Claude API key set — staying dormant. Click the toolbar button, open Settings, paste a key."
  );

  // Wake up the moment the key shows up. We don't tear down on removal
  // (rare, deliberate action) — a Reddit-tab reload will clear chips.
  bonClientSubscribe((event) => {
    if (event.type !== "api-key-changed" || featuresStarted) {
      return;
    }

    void (async () => {
      if (await hasClaudeApiKey()) {
        startFeatures();
      }
    })();
  });
}

void bootstrap();
