// Content-script orchestrator. Each feature owns its own init + tick
// functions; this file wires them up, then runs a single shared
// MutationObserver that fans the work out so we don't pay 4× the cost of
// independent observers on document.body.
//
// Everything here is gated on the Claude API key being set. Without a key
// the extension can't actually investigate anything, so showing chips and
// harvesting data would just be clutter. We stay dormant until the key
// arrives, then bring the features up live (no Reddit-tab reload needed).

import { clientSend, clientSubscribe } from "./client.ts";
import {
  inlineTagsInit,
  inlineTagsMark,
  inlineTagsResetNav,
} from "./features/inline-tags";
import { piiBlurInit } from "./utils/pii_blur.ts";
import {
  passiveHarvestInit,
  passiveHarvestTick,
} from "./features/passive-harvest";
import {
  profileInjectionInit,
  profileInjectionTick,
} from "./features/profile-injection";
import { reportingInit, reportingResetNav } from "./features/reporting";
import {
  statusDetectionInit,
  statusDetectionResetNav,
  statusDetectionScan,
} from "./features/status-detection";
import {
  subredditInvestigationInit,
  subredditInvestigationTick,
} from "./features/subreddit-investigation";

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
    inlineTagsMark();
    passiveHarvestTick();
    profileInjectionTick();
    statusDetectionScan();
    subredditInvestigationTick();
  });
}

function startFeatures(): void {
  if (featuresStarted) {
    return;
  }

  featuresStarted = true;

  inlineTagsInit();
  passiveHarvestInit();
  profileInjectionInit();
  reportingInit();
  statusDetectionInit();
  subredditInvestigationInit();

  // Coalesce scan work to one execution per animation frame. Reddit's SPA
  // can fire hundreds of mutations per second while mounting big comment
  // trees (e.g. WSB megathreads); without throttling we'd run every scan
  // for every mutation and freeze the page.
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      reportingResetNav();
      statusDetectionResetNav();
      inlineTagsResetNav();
    }

    scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function hasAnyApiKey(): Promise<boolean> {
  // We don't know which vendor the operator picked from a content script;
  // any key on file is enough to let the features wake up. Mismatches
  // between vendor selection and the available key surface in the
  // background-side investigation/AI-command paths.
  try {
    const { hasKey } = await clientSend<{
      hasKey: Record<string, boolean>;
    }>({
      type: "get-api-keys",
    });

    return Object.values(hasKey).some(Boolean);
  } catch (error) {
    console.error("[Bot or Not] failed to read api-key state", error);
    return false;
  }
}

async function bootstrap(): Promise<void> {
  // PII blur is independent of feature state — it should work even on a
  // dormant install (the operator may have configured privacy before
  // pasting their API key).
  void piiBlurInit();

  if (await hasAnyApiKey()) {
    startFeatures();
    return;
  }

  console.log(
    "[Bot or Not] No API key set — staying dormant. Click the toolbar button, open Settings, paste a key."
  );

  // Wake up the moment the key shows up. We don't tear down on removal
  // (rare, deliberate action) — a Reddit-tab reload will clear chips.
  clientSubscribe((event) => {
    if (event.type !== "api-key-changed" || featuresStarted) {
      return;
    }

    void (async () => {
      if (await hasAnyApiKey()) {
        startFeatures();
      }
    })();
  });
}

void bootstrap();
