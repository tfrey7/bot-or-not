#!/usr/bin/env node
// Prepends a section to CHANGELOG.md for the current package.json version.
// Bullets are the per-feature commit subjects between the previous vX.Y.Z tag
// and HEAD (the Publish commit itself doesn't exist yet at this point in the
// publish flow). Idempotent: skips if the version already has a section.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repoSlug = "tfrey7/bot-or-not";

const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const version = pkg.version;

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const existing = fs.existsSync(changelogPath)
  ? fs.readFileSync(changelogPath, "utf8")
  : "";

if (existing.includes(`## [${version}]`)) {
  console.log(
    `[Bot or Not] CHANGELOG.md already has ${version}; skipping`
  );
  process.exit(0);
}

const tags = execSync("git tag --list 'v*' --sort=-v:refname", {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .map((t) => t.trim())
  .filter(Boolean);

const prevTag = tags.find((t) => t !== `v${version}`);
const range = prevTag ? `${prevTag}..HEAD` : "HEAD";

const subjects = execSync(`git log --pretty=format:%s ${range}`, {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s && !/^(Publish|Ship)\s+\d+\./.test(s));

const today = new Date().toISOString().slice(0, 10);
const bullets = subjects.length
  ? subjects.map((s) => `- ${s}`).join("\n")
  : "- _(no feature commits between releases)_";

const newSection = `## [${version}] — ${today}\n${bullets}\n\n`;

const header = `# Changelog

Notable changes to Bot or Not. Signed \`.xpi\` builds for each version are attached to the matching [GitHub Release](https://github.com/${repoSlug}/releases).

`;

let updated;
if (existing.startsWith("# Changelog")) {
  const headerEnd = existing.indexOf("## [");
  if (headerEnd === -1) {
    updated = existing.replace(/\s*$/, "\n\n") + newSection;
  } else {
    updated =
      existing.slice(0, headerEnd) + newSection + existing.slice(headerEnd);
  }
} else {
  updated = header + newSection + existing;
}

fs.writeFileSync(changelogPath, updated);
console.log(
  `[Bot or Not] CHANGELOG.md: added ${version} with ${subjects.length} ${
    subjects.length === 1 ? "entry" : "entries"
  } (range: ${range})`
);
