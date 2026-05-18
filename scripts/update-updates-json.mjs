#!/usr/bin/env node
// Updates ./updates.json with the signed .xpi for the current package.json version.
// Run after `npm run sign` so the artifact exists in web-ext-artifacts/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repoSlug = "tfrey7/bot-or-not";

const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8")
);

const version = pkg.version;
const addonId = manifest.browser_specific_settings.gecko.id;

const artifactsDir = path.join(repoRoot, "web-ext-artifacts");
const xpi = fs
  .readdirSync(artifactsDir)
  .find((f) => f.endsWith(`-${version}.xpi`));

if (!xpi) {
  console.error(
    `[Bot or Not] no signed .xpi for version ${version} in web-ext-artifacts/ — run \`npm run sign\` first`
  );
  process.exit(1);
}

const tag = `v${version}`;
const updateLink = `https://github.com/${repoSlug}/releases/download/${tag}/${xpi}`;

const updatesPath = path.join(repoRoot, "updates.json");
const updates = fs.existsSync(updatesPath)
  ? JSON.parse(fs.readFileSync(updatesPath, "utf8"))
  : { addons: { [addonId]: { updates: [] } } };

updates.addons[addonId] ??= { updates: [] };
const list = updates.addons[addonId].updates;

const existing = list.find((u) => u.version === version);
if (existing) {
  existing.update_link = updateLink;
} else {
  list.push({ version, update_link: updateLink });
}

list.sort((a, b) => compareVersions(a.version, b.version));

fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + "\n");
console.log(
  `[Bot or Not] updates.json: ${list.length} version(s); latest ${list[list.length - 1].version}`
);
console.log(`[Bot or Not] update_link: ${updateLink}`);

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
