# Bot or Not — Claude Guidelines

## Dev Workflow

| Command             | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Launch extension in Firefox (hot-reloads via web-ext)                                                   |
| `npm run lint`      | Lint all `src/**/*.{ts,js}` with typescript-eslint                                                      |
| `npm run format`    | Format all `src/**/*.{ts,js}` with Prettier                                                             |
| `npm run typecheck` | Run `tsc --noEmit` against `src/**/*.ts`                                                                |
| `npm run build`     | Build an unsigned extension zip into `web-ext-artifacts/`                                               |
| `npm run sign`      | Sign and publish to AMO (self-distribution, unlisted). Reads `AMO_API_KEY`/`AMO_API_SECRET` from `.env` |
| `npm run investigate -- <username> [--no-web-search] [--json]` | Run the bot/human investigation pipeline against a Reddit username outside the extension. Lets you iterate on the investigation prompt without rebuilding. Reads `CLAUDE_API_KEY` from `.env` (gitignored). |

### Release

1. Bump the version in **both** `manifest.json` and `package.json` (keep them in sync).
2. Run `npm run sign`.
3. Run `npm run updates-json` to append the new version to `updates.json` (auto-update manifest for self-hosted installs).
4. Commit (`manifest.json`, `package.json`, `updates.json`).
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

## Code organization

Every screen and pipeline lives under `src/features/<feature>/`. Each directory IS the feature — drop the directory, remove the one or two imports from `src/content_script.ts` / `src/background.ts` / `src/reports.html`, and the feature is gone.

Top-level files in `src/` are intentional cross-feature contracts (the canonical factor + archetype list, the verdict-derivation math, shared domain types, data migrations, shared utils). Anything that lives there has a reason to be there — keep new code under `features/` unless it's genuinely shared across features.

General file-role rules (`index.ts`, `logic.ts`, `data.ts`, `<widget>.ts`; avoid grab-bag files; separate logic from rendering) live in the `writing-code` Skill.

### Naming exported names

ES modules everywhere; cross-file communication is via `import` / `export` (no IIFE/`globalThis`).

- Every exported name gets the `bon` prefix so it's obvious in import lists where the symbol came from.
- **Feature-internal helpers** used by other files in the same feature get a `bon<Feature>` prefix (`bonAnalyticsSvgRoot`, `bonReportsRow`). The long name keeps ownership obvious and prevents collisions if another feature grows similar helpers.
- **Cross-feature utilities** go in `src/utils/<topic>.ts` with a short `bon` prefix (`bonFmtUsd`, `bonExtractJson`).
- TypeScript domain types are `bon`-free (just `Report`, `Investigation`, `Factor`, etc.) since they're already namespaced by the `types.ts` import path.

### Refactoring guidelines (when asked to "feature-ify" something)

1. Survey the file to identify the seams (one widget = one render function = one file).
2. `git mv` the main file into `src/features/<feature>/index.ts` to preserve history.
3. Pull pure data into `logic.ts` / `data.ts` first — these are the easiest extractions.
4. Pull each widget into its own file, exporting one `bon<Feature><Widget>` function.
5. Slim `index.ts` to an orchestrator: data-load → call each widget → assemble. Keep page chrome (header/empty/footnote) inline if tiny.
6. Update any `import` sites in `background.ts` / `content_script.ts` / `reports.html` to point at the new feature path.
7. Run `npm run typecheck && npm run lint && npm run format && npm run build`. Done.

## Project-specific conventions

- DOM/CSS prefix is `bon-`.
- Console log tag is `[Bot or Not]`.

General code style, naming, comments, and TypeScript conventions live in the `writing-code` Skill.
