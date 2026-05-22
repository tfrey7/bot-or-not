// Regenerates README.md from docs/README.template.md, substituting version,
// date, canonical factor + archetype lists from src/factors.ts, and a screenshot
// table built from whatever PNGs are present in docs/screenshots/.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { BON_ARCHETYPES, BON_FACTORS } from "../src/factors.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const manifest = JSON.parse(
  readFileSync(join(repoRoot, "manifest.json"), "utf-8"),
);
const template = readFileSync(
  join(repoRoot, "docs/README.template.md"),
  "utf-8",
);

const today = new Date().toISOString().slice(0, 10);

const factorList = BON_FACTORS.map((factor) => `- ${factor.label}`).join("\n");
const archetypeList = BON_ARCHETYPES.map(
  (archetype) => `- **${archetype.label}** — ${archetype.blurb}`,
).join("\n");

const screenshotTargets = [
  { label: "Reports overview", file: "reports.png" },
  { label: "Single dossier", file: "dossier.png" },
];

const presentScreenshots = screenshotTargets.filter((shot) =>
  existsSync(join(repoRoot, "docs/screenshots", shot.file)),
);

let screenshotsSection: string;
if (presentScreenshots.length === 0) {
  screenshotsSection =
    "_Run `npm run screenshots` to capture fresh PNGs from a live extension._";
} else {
  const header =
    "| " + presentScreenshots.map((shot) => shot.label).join(" | ") + " |";
  const separator =
    "| " + presentScreenshots.map(() => "---").join(" | ") + " |";
  const row =
    "| " +
    presentScreenshots
      .map((shot) => `![${shot.label}](docs/screenshots/${shot.file})`)
      .join(" | ") +
    " |";

  screenshotsSection = [header, separator, row].join("\n");
}

const rendered = template
  .replaceAll("{{version}}", manifest.version)
  .replaceAll("{{date}}", today)
  .replaceAll("{{factor_count}}", String(BON_FACTORS.length))
  .replaceAll("{{factor_list}}", factorList)
  .replaceAll("{{archetype_list}}", archetypeList)
  .replaceAll("{{screenshots_section}}", screenshotsSection);

writeFileSync(join(repoRoot, "README.md"), rendered);

console.log(
  `[Bot or Not] README.md regenerated — v${manifest.version}, ${today}` +
    ` (${presentScreenshots.length}/${screenshotTargets.length} screenshots present)`,
);
