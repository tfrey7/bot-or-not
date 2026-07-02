// Prepares the browser-console fixture harvester: injects the username
// list into harvest-fixtures.browser.js, copies the result to the
// clipboard, and prints the paste-into-Reddit instructions.
//
// Usage:
//   npm run harvest                 -- harvest the reference set
//   npm run harvest -- user1 user2  -- harvest an ad-hoc set

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REFERENCE_ACCOUNTS } from "./reference_accounts.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(SCRIPTS_DIR, "harvest-fixtures.browser.js");
const USERNAMES_MARKER = "/* __USERNAMES__ */ []";

const usernames =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : REFERENCE_ACCOUNTS.map((account) => account.username);

const template = readFileSync(TEMPLATE_PATH, "utf8");
if (!template.includes(USERNAMES_MARKER)) {
  console.error(
    `harvest-fixtures.browser.js is missing the "${USERNAMES_MARKER}" marker.`
  );
  process.exit(1);
}

const script = template.replace(USERNAMES_MARKER, JSON.stringify(usernames));

execSync("pbcopy", { input: script });

console.log(`Harvest script for ${usernames.length} account(s) copied to clipboard:`);
for (const username of usernames) {
  console.log(`  u/${username}`);
}
console.log("");
console.log("Next steps:");
console.log("  1. Open any reddit.com page in your logged-in Firefox.");
console.log("  2. Open the devtools console (Cmd+Opt+K).");
console.log('  3. Paste and hit Enter ("allow pasting" first if prompted).');
console.log("  4. Wait for the Done line — bon-fixtures.json downloads itself.");
console.log("  5. Run: npm run ingest");
