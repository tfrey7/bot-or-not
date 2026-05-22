// Drives Playwright-Firefox against a dedicated profile with the built
// extension loaded + a fixture of real reports, toggles PII blur, and captures
// the README screenshots into docs/screenshots/.
//
// Default flow waits for you to install the extension manually via
// about:debugging (set SCREENSHOT_AUTO_INSTALL=1 to drop the .xpi into the
// profile directly).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

import { firefox, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const distDir = join(repoRoot, "dist");
const screenshotsDir = join(repoRoot, "docs/screenshots");
const fixturePath = join(screenshotsDir, "fixture.json");
const profileDir = join(homedir(), ".bot-or-not-screenshot-profile");
const xpiTmpPath = join(repoRoot, "dist.xpi");

const PINNED_UUID = "00000000-aaaa-bbbb-cccc-000000000001";
const VIEWPORT = { width: 1280, height: 800 };
const MANUAL_INSTALL_TIMEOUT_MS = 5 * 60_000;

const autoInstall = process.env.SCREENSHOT_AUTO_INSTALL === "1";

if (!existsSync(join(distDir, "manifest.json"))) {
  throw new Error(
    "dist/ has no manifest.json — run `npm run build` before capturing screenshots.",
  );
}

if (!existsSync(fixturePath)) {
  throw new Error(
    `Fixture missing: ${fixturePath}\n` +
      "Export a backup from your real Bot or Not (Settings → Sync → Download " +
      "backup) and save it to docs/screenshots/fixture.json. The file is " +
      "gitignored.",
  );
}

const manifest = JSON.parse(
  readFileSync(join(distDir, "manifest.json"), "utf-8"),
);
const extensionId: string = manifest.browser_specific_settings.gecko.id;

const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  reports?: Record<string, unknown>;
};
if (!fixture.reports || Object.keys(fixture.reports).length === 0) {
  throw new Error(
    "Fixture has no reports — export from a populated Bot or Not instance.",
  );
}

mkdirSync(profileDir, { recursive: true });

const userPrefLines = [
  `user_pref("xpinstall.signatures.required", false);`,
  `user_pref("extensions.autoDisableScopes", 0);`,
  `user_pref("extensions.enabledScopes", 15);`,
  `user_pref("browser.startup.homepage", "about:blank");`,
];
if (autoInstall) {
  userPrefLines.push(
    `user_pref("extensions.webextensions.uuids", '{"${extensionId}":"${PINNED_UUID}"}');`,
  );
}
writeFileSync(join(profileDir, "user.js"), userPrefLines.join("\n"));

if (autoInstall) {
  rmSync(xpiTmpPath, { force: true });
  execSync(`cd "${distDir}" && zip -r -q "${xpiTmpPath}" .`);
  mkdirSync(join(profileDir, "extensions"), { recursive: true });
  copyFileSync(
    xpiTmpPath,
    join(profileDir, "extensions", `${extensionId}.xpi`),
  );
}

console.log("[Bot or Not] Launching Firefox via Playwright…");

const browser = await firefox.launchPersistentContext(profileDir, {
  headless: false,
  viewport: VIEWPORT,
});

try {
  const page = browser.pages()[0] ?? (await browser.newPage());
  const reportsPage = await openReportsPage(page);

  await reportsPage.evaluate(async (payload) => {
    await browser.storage.local.set({
      reports: payload.reports,
      hidePii: true,
    });
  }, fixture);

  await reportsPage.reload();
  await reportsPage.waitForSelector(".bon-table tbody tr", {
    timeout: 10_000,
  });

  await reportsPage.screenshot({
    path: join(screenshotsDir, "reports.png"),
    clip: { x: 0, y: 0, ...VIEWPORT },
  });
  console.log("[Bot or Not] reports.png ✓");

  await reportsPage.locator(".bon-table tbody tr").first().click();
  await reportsPage.waitForSelector("#bon-detail-pane *", { timeout: 5_000 });
  await reportsPage.waitForTimeout(400);

  await reportsPage.screenshot({
    path: join(screenshotsDir, "dossier.png"),
    clip: { x: 0, y: 0, ...VIEWPORT },
  });
  console.log("[Bot or Not] dossier.png ✓");
} finally {
  await browser.close();
  if (autoInstall) {
    rmSync(xpiTmpPath, { force: true });
  }
}

console.log("[Bot or Not] Screenshots saved to docs/screenshots/.");

async function openReportsPage(initialPage: Page): Promise<Page> {
  if (autoInstall) {
    const reportsUrl = `moz-extension://${PINNED_UUID}/src/reports.html`;
    await initialPage.goto(reportsUrl);
    await initialPage.waitForLoadState("domcontentloaded");
    return initialPage;
  }

  await initialPage.goto("about:debugging#/runtime/this-firefox");

  console.log("[Bot or Not] Firefox is open. To install the extension:");
  console.log("  1. Click 'Load Temporary Add-on…' in the page");
  console.log(`  2. Pick: ${join(distDir, "manifest.json")}`);
  console.log("  3. Click the Bot or Not toolbar button (puzzle-piece menu)");
  console.log("");
  console.log("[Bot or Not] Waiting up to 5 min for the reports page…");

  const reportsPattern = /^moz-extension:\/\/[a-f0-9-]+\/src\/reports\.html/;
  const startedAt = Date.now();

  while (Date.now() - startedAt < MANUAL_INSTALL_TIMEOUT_MS) {
    for (const candidate of browser.pages()) {
      if (reportsPattern.test(candidate.url())) {
        console.log(`[Bot or Not] Reports page detected at ${candidate.url()}`);
        return candidate;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    "Timed out waiting for the extension's reports page. Was the extension " +
      "installed and its toolbar button clicked?",
  );
}
