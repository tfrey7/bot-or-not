# Bot or Not — Claude Guidelines

## Before editing code

Invoke the `writing-code` Skill (`Skill(writing-code)`) before any Edit/Write/NotebookEdit on source files in this repo. It holds the project's code style, naming, comments, file-role, and TypeScript conventions — none of which are duplicated in this CLAUDE.md. Skipping the skill means edits drift from project norms.

## Dev Workflow

| Command             | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Claim the Firefox dev singleton in this worktree (kills any other strand's dev server, then starts vite + web-ext here). Hot-reloads. |
| `npm run lint`      | Lint all `src/**/*.{ts,js}` with typescript-eslint                                                      |
| `npm run format`    | Format all `src/**/*.{ts,js}` with Prettier                                                             |
| `npm run typecheck` | Run `tsc --noEmit` against `src/**/*.ts`                                                                |
| `npm run deadcode`  | Find unused files, exports, types, and dependencies with [knip](https://knip.dev). Entry points (manifest scripts, `reports.html`, `scripts/`) are configured in `knip.json` — `tsc`/ESLint can't see cross-file unused exports, so this is the only check that catches them. Exits non-zero when it finds something. |
| `npm run build`     | Build an unsigned extension zip into `web-ext-artifacts/`                                               |
| `npm run sign`      | Sign and publish to AMO (self-distribution, unlisted). Reads `AMO_API_KEY`/`AMO_API_SECRET` from `.env` |
| `npm run investigate -- <username> [--json] [--fixture <file>]` | Run the bot/human investigation pipeline against a Reddit username outside the extension. Lets you iterate on the investigation prompt without rebuilding. Reads `CLAUDE_API_KEY` from `.env` (gitignored). Live Reddit fetch no longer works from the CLI (see "Investigation fixtures") — pass `--fixture fixtures/<username>.json` instead. |
| `npm run harvest [-- user1 user2 …]` | Copy the browser-console fixture harvester to the clipboard (reference set by default). Paste it into a logged-in Reddit tab's devtools console; it downloads `bon-fixtures.json`. |
| `npm run ingest [-- <path>]` | Split the newest `~/Downloads/bon-fixtures*.json` into per-user `fixtures/<username>.json` files. |
| `npm run regress [-- user1 …]` | Run every fixtured reference account through the pipeline and diff against the hand-judged expectations in `scripts/reference_accounts.ts`. Run after any prompt or verdict-math change. ~$0.25/account in Claude calls. |
| `npm run outcomes [-- <backup.json>]` | Verdict-outcome analysis over an exported backup (defaults to the newest `~/Downloads/bot-or-not-backup-*.json`): verdict × account-status table, gone-rate by bot probability and verdict age, factor/persona comparison between Reddit-suspended and still-active suspected bots, longest-surviving bot verdicts. No network or Claude calls — statuses are only as fresh as the export. |

### Investigation fixtures (prompt-iteration loop)

Reddit hard-blocks unauthenticated HTTP at the network level (403 "blocked by network security" for curl, Node, and even logged-out real browsers), so the CLI can't fetch profiles live anymore. The only place Reddit JSON is still fetchable is a same-origin tab riding the operator's logged-in session — and Reddit's CSP blocks `connect-src` to localhost, so the data comes back as a file download, not a POST. The loop that works:

1. `npm run harvest` — puts the console harvester on the clipboard (usernames injected from `scripts/reference_accounts.ts`, or pass your own).
2. Paste into the devtools console of any logged-in reddit.com tab → `bon-fixtures.json` downloads.
3. `npm run ingest` — splits it into `fixtures/<username>.json` (gitignored; third-party Reddit content stays out of the repo).
4. `npm run regress` — pipeline vs. hand-judged expectations, or `npm run investigate -- <user> --fixture fixtures/<user>.json` for one account.

Fixtures are frozen snapshots — that's a feature for regression (only the prompt varies between runs), but re-harvest when an account's recent behavior matters. `scripts/reference_accounts.ts` is the canonical regression set; when the user declares a new known account, add it there with its expected verdict band + persona.

### Parallel strands

Strand lifecycle (spawn, list, ship/finish, delete) is handled by the **Vibe Stranding** IntelliJ plugin and its MCP tools — see `~/.claude/general/workflow.md` for the general flow. Don't reach for hand-rolled `git worktree` commands or in-repo scripts; the plugin keeps the IDE tabs and the git side in sync.

Project-specific bits:

- Worktrees live at `../bot-or-not-strands/<slug>/` on branches `strand/<slug>`. Symlink `node_modules` and `.env` from the main checkout so one `npm install` covers all strands. (The plugin handles this when spawning.)
- **Only one worktree can be live in Firefox at a time** (Firefox can load exactly one copy of the extension). `npm run dev` in any worktree kills the previously-active dev server and takes over. The Firefox profile (`~/.bot-or-not-dev-profile/`) is persistent — configured in `vite.config.js` — so swapping which worktree is active preserves extension storage, the open reports tab, and other state.
- There is no orchestrator session. Any session — main checkout or strand — can spawn sibling strands and can run `npm run dev` to claim the Firefox singleton. Publishing happens from whichever session is on `main`.
- **Never auto-claim the dev singleton.** A strand session must not run `npm run dev` (or otherwise restart the dev server) on its own — not at the start of work, not after a build, not when a task wraps up. Stealing the singleton out from under whichever worktree the user is actively testing in is disruptive and frequent across parallel strands. Wait until the user explicitly asks ("grab dev here", "run dev in this strand", etc.). Typecheck / lint / build inside the worktree are fine — they don't touch the Firefox singleton.

### Publish a new version

Operates on `main` once all desired features have been shipped. Commit message convention is `Publish X.Y.Z: <one-line summary>` (historically these said `Ship X.Y.Z:` — old vocabulary).

1. Bump the version in **both** `manifest.json` and `package.json` (keep them in sync).
2. Run `npm run sign`.
3. Run `npm run updates-json` to append the new version to `updates.json` (auto-update manifest for self-hosted installs) and prepend a section to `CHANGELOG.md` (bullets are the per-feature commits since the previous tag). Both files are rewritten by the script — no manual editing.
4. Commit (`manifest.json`, `package.json`, `updates.json`, `CHANGELOG.md`).
5. Tag the commit: `git tag vX.Y.Z` (matching the version you bumped to).
6. Push: `git push && git push origin vX.Y.Z` (push the tag explicitly rather than `--tags` so stray local tags don't leak).
7. Create the GitHub release with the signed `.xpi` attached:
   `gh release create vX.Y.Z web-ext-artifacts/*-X.Y.Z.xpi --title "vX.Y.Z" --generate-notes`

The `.xpi` lives in GitHub Releases (versioned, doesn't bloat the repo); `updates.json` lives at the repo root and is served by GitHub Pages at `https://tfrey7.github.io/bot-or-not/updates.json`. Firefox polls that URL for installed unlisted copies and auto-updates within ~24h. The `update_url` baked into `manifest.json` is what wires the two together.

**One-time setup:** GitHub Pages must be enabled (repo Settings → Pages → Deploy from `main` branch, `/` root) for the auto-update URL to resolve.

## Architecture

Three execution contexts, communicating via `browser.runtime.sendMessage`:

- **Content scripts** — registered in `manifest.json` under `content_scripts`. One on every Reddit page, one on `google.com/search*` (for the user-initiated Google dossier harvest). DOM only; never touch storage directly except via `storage.onChanged` listeners.
- **Background (service worker)** — `src/background.ts` is the message dispatch; feature work lives in `src/features/<feature>/handlers.ts`. Owns all storage I/O. Runs AI investigations via the Claude API. Sweeps orphaned in-flight investigations on startup. Runs one-time data migrations from `src/migrations/`.
- **UI surfaces** — `src/reports.html` is the only one. The toolbar button opens this page directly; there is no popup. Reads state via background messages.

### Bot analysis pipeline

- Triggered automatically when a user is reported, or on demand from the reports page.
- `src/features/investigation/prompt.md` is the system prompt sent to Claude. Editing it changes how factors are scored.
- Claude returns one `{score, confidence, reasoning, evidence}` object per factor (bot↔human axis, `-1` = strong human, `+1` = strong bot), plus a top-level `persona: { label, reasoning, archetypes }` block and a top-level `region` block.
- `src/verdict.ts` aggregates deterministically from the factor scores into a `botProbability` and bins it into one of 5 verdict labels. Re-running the aggregator on stored factor scores must reproduce the same verdict — **verdict logic lives only in `verdict.ts`**; don't bake it into the prompt or the background. The actual math (weights, floors, bands) is documented at the top of that file.
- **Persona is an LLM pick, not derived from factor math.** The bot↔human scalar and the persona answer different questions: archetypes describe flavors of *human* behavior, so a human-archetype persona is consistent with a positive (human-leaning) verdict. `bot` is a valid label but not a radar axis — the bot↔human scalar already answers that.

### Factor / archetype contract

- `src/factors.ts` is the **canonical list** of both factors and persona archetypes — keys, labels, and ordering.
- `src/features/investigation/prompt.md` must list factors in the same order with the same keys, and must produce `persona.archetypes` with the same archetype keys.
- If you add/remove/rename a factor or archetype in `factors.ts`, update `prompt.md` so Claude's output matches what the UI expects. (And add a migration under `src/migrations/` if stored data needs rewriting — see `crank_to_zealot.ts` for the pattern.)

### Storage shape

Two top-level keys in `browser.storage.local`: `reports` (keyed by username) and `claudeApiKey`. **The authoritative schema is `src/types.ts`** — `Report`, `Investigation`, `Factor`, `Persona`, `ActivityData`, etc. Read it there; don't re-document it here.

## Patterns

- **Storage I/O is background-only.** Content script, reports page, and any other UI message the background (`get-user-report`, `update-user-status`, …). Don't call `browser.storage.local.{get,set}` from anywhere else. `storage.onChanged` listeners in UI / content scripts are fine — they're notifications, not I/O.
- All source files are TypeScript ES modules — Vite bundles each entry point so content scripts can use `import` despite the manifest treating them as classic scripts.
- Shared domain types live in `src/types.ts`. Import them with the `.ts` extension (Vite + `allowImportingTsExtensions` handles it).
- **Profile-page / DOM injection is idempotent.** Check for the container ID before injecting. Reddit is an SPA and re-renders constantly; a single shared `MutationObserver` in `src/content_script.ts` fans tick work out to each feature per animation frame. Features should be cheap to re-tick.
- On background startup, investigations stuck mid-flight are swept to `status: "error"` — the previous worker died (web-ext reload, browser restart, service-worker eviction) and won't be back to finish them.
- Inline username tags are keyed by **lowercase** username (Reddit's routing is case-insensitive).

## Privacy / PII redaction

When the operator turns on "Blur usernames" in settings, `body.bon-hide-pii` is set. CSS lives in `src/app.css` (reports page) and `src/content_script.css` (Reddit pages). Hovering or focusing any redacted element reveals. The goal is screenshot safety — operators publish reports into subreddits with anti-doxxing rules, and even our scoring rationale can be sensitive.

Two marker classes, picked by what's being hidden:

- **`bon-pii-name`** — usernames. Destructive: `color: transparent` removes the original glyphs entirely (no pixels for AI to deblur from a short isolated token), a `::after` overlay paints a fuzzy bar over the bounding box (covers nested avatars too), and a `::before` adds a crisp `u/` prefix so screenshots still read as "this is a user reference, redacted." Reddit's own profile links (`<a href*="/user/">`, `<a href*="/u/">`) match by URL pattern automatically — no manual tagging needed in content scripts.
- **`bon-pii`** — everything else sensitive. General blur on the rendered subtree (TV-news style). Cheap, propagates through arbitrary descendants regardless of their own color/background overrides. Used for long-form text in container elements (e.g. the Human/Bot signal bullet `<ul>`) and short value tokens (cake day, karma). Tag the leaf container that holds the redactable content, not an outer wrapper that also contains labels you want to stay legible.

**When you render any of the following, tag the element at the render site:**

| What | Class |
| ---- | ----- |
| Reddit usernames (links, headings, tooltips, table cells, hover cards…) | `bon-pii-name` |
| Reddit avatars | covered automatically when the surrounding `<a>` to `/user/` or `/u/` is tagged |
| Cake day + karma (the pair is a near-unique fingerprint) | `bon-pii` |
| Investigation factor bullets / signal lists (criteria we use to rate someone may itself violate a subreddit's rules) | `bon-pii` (on the `<ul>` of bullets, not the section container — keep "Human signals" / "Bot signals" headings legible) |
| Anything else that could identify a specific Reddit user or expose our scoring rationale | `bon-pii-name` for username tokens, `bon-pii` otherwise |

**When you add a new category of identifying data, extend this table so future agents don't miss it.**

## Code organization

Every screen and pipeline lives under `src/features/<feature>/`. Each directory IS the feature — drop the directory, remove the one or two imports from `src/content_script.ts` / `src/background.ts` / `src/reports.html`, and the feature is gone.

Top-level files in `src/` are intentional cross-feature contracts (the canonical factor + archetype list, the verdict-derivation math, shared domain types, data migrations, shared utils). Anything that lives there has a reason to be there — keep new code under `features/` unless it's genuinely shared across features.

General file-role rules (`index.ts`, `logic.ts`, `data.ts`, `<widget>.ts`; avoid grab-bag files; separate logic from rendering) live in the `writing-code` Skill.

### Refactoring guidelines (when asked to "feature-ify" something)

1. Survey the file to identify the seams (one widget = one render function = one file).
2. `git mv` the main file into `src/features/<feature>/index.ts` to preserve history.
3. Pull pure data into `logic.ts` / `data.ts` first — these are the easiest extractions.
4. Pull each widget into its own file, exporting one render function named for the widget.
5. Slim `index.ts` to an orchestrator: data-load → call each widget → assemble. Keep page chrome (header/empty/footnote) inline if tiny.
6. Update any `import` sites in `background.ts` / `content_script.ts` / `reports.html` to point at the new feature path.
7. Run `npm run typecheck && npm run lint && npm run format && npm run build`. Done.

## Project-specific conventions

- DOM/CSS prefix is `bon-`.
- Console log tag is `[Bot or Not]`.

General code style, naming, comments, and TypeScript conventions live in the `writing-code` Skill.
