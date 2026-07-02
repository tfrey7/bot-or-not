// Splits the bon-fixtures.json download (produced by the browser harvest
// script) into per-user fixture files under fixtures/, ready for
// `npm run investigate -- <user> --fixture fixtures/<user>.json` and
// `npm run regress`.
//
// Usage:
//   npm run ingest              -- newest ~/Downloads/bon-fixtures*.json
//   npm run ingest -- <path>    -- a specific combined file

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_DIR = join(REPO_ROOT, "fixtures");

function newestDownload(): string {
  const downloads = join(homedir(), "Downloads");
  const candidates = readdirSync(downloads)
    .filter((name) => /^bon-fixtures.*\.json$/.test(name))
    .map((name) => join(downloads, name));

  if (candidates.length === 0) {
    console.error("No bon-fixtures*.json in ~/Downloads — run npm run harvest first.");
    process.exit(1);
  }

  candidates.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  return candidates.at(-1)!;
}

const sourcePath = process.argv[2] ?? newestDownload();

interface Fixture {
  username: string;
  harvestedAt: string;
  botBouncerStatus: string | null;
  profile: {
    submitted: { data: { children: unknown[] } };
    comments: { data: { children: unknown[] } };
  };
}

const fixtures = JSON.parse(readFileSync(sourcePath, "utf8")) as Fixture[];
mkdirSync(FIXTURES_DIR, { recursive: true });

console.log(`Ingesting ${basename(sourcePath)} (${fixtures.length} account(s)):`);
for (const fixture of fixtures) {
  const safeName = fixture.username.replace(/[^A-Za-z0-9_-]/g, "_");
  const outPath = join(FIXTURES_DIR, `${safeName}.json`);
  writeFileSync(outPath, JSON.stringify(fixture));

  const posts = fixture.profile.submitted.data.children.length;
  const comments = fixture.profile.comments.data.children.length;
  console.log(
    `  ${fixture.username}: posts=${posts} comments=${comments} botbouncer=${fixture.botBouncerStatus ?? "none"} -> fixtures/${safeName}.json`
  );
}
