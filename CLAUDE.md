# Bot or Not — Claude Guidelines

## Before editing code

Invoke the `writing-code` Skill (`Skill(writing-code)`) before any Edit/Write/NotebookEdit on source files in this repo. It holds the project's code style, naming, comments, file-role, and TypeScript conventions — none of which are duplicated in this CLAUDE.md. Skipping the skill means edits drift from project norms.

## Dev Workflow

| Command             | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Launch extension in Firefox (hot-reloads via web-ext)                                                   |
| `npm run new-agent [-- <slug>]` | Spawn a long-lived agent worktree at `../bot-or-not-worktrees/<slug>/` (branch `agent/<slug>`, with `node_modules` and `.env` symlinked from main). Slug names an agent identity, not a feature. With no slug, auto-picks the next unused alphabetical name (alice, bob, carol, …, zane). |
| `npm run agents` | Print a status table of all live agent worktrees: unshipped commit count, working-tree state (clean / N modified / N untracked), and last commit subject. Run from the orchestrator. |
| `npm run be-agent -- <slug>` | Assume the identity of an existing agent: `cd` into its worktree and `exec claude` there. Run in a **new terminal tab** — that tab becomes agent `<slug>`'s session for its lifetime. |
| `npm run ship [-- <slug>]` | Ship the agent's pending commits to main: rebase onto main → fast-forward. **Worktree and branch stay alive** — the agent can keep working. Infers slug from current branch when run inside an `agent/<slug>` worktree. |
| `npm run retire-agent -- <slug> [-- --force]` | Tear down an agent: remove its worktree and delete its branch. Refuses if the agent has uncommitted changes or unshipped commits unless `--force` is passed. |
| `npm run dev-switch -- <slug>` | Make `<slug>`'s worktree the active dev target: kill the current `npm run dev`, start a new one in that worktree. Pass `main` as the slug to make the main checkout itself active. Pair with `-- --stop` or `-- --status`. Run from the main checkout (orchestrator). |
| `npm run lint`      | Lint all `src/**/*.{ts,js}` with typescript-eslint                                                      |
| `npm run format`    | Format all `src/**/*.{ts,js}` with Prettier                                                             |
| `npm run typecheck` | Run `tsc --noEmit` against `src/**/*.ts`                                                                |
| `npm run build`     | Build an unsigned extension zip into `web-ext-artifacts/`                                               |
| `npm run sign`      | Sign and publish to AMO (self-distribution, unlisted). Reads `AMO_API_KEY`/`AMO_API_SECRET` from `.env` |
| `npm run investigate -- <username> [--json]` | Run the bot/human investigation pipeline against a Reddit username outside the extension. Lets you iterate on the investigation prompt without rebuilding. Reads `CLAUDE_API_KEY` from `.env` (gitignored). |

### Parallel agent worktrees

Parallel agent work on this project uses long-lived git worktrees so edits to shared files (`src/types.ts`, `src/background.ts`, `src/migrations/index.ts`, etc.) don't co-mingle in a single tree. The general worktree workflow is documented in `~/.claude/general/workflow.md`; project-specific bits:

- Worktrees live at `../bot-or-not-worktrees/<slug>/`. Branches are `agent/<slug>`. The slug names an *agent identity*, not a feature — each agent ships many features over its lifetime.
- Each worktree symlinks `node_modules` and `.env` from the main checkout — one `npm install`, all worktrees reuse it.
- **Only one worktree can be live in Firefox at a time** (Firefox can load exactly one copy of the extension). The active worktree is the one whose `npm run dev` is currently running. The Firefox profile (`~/.bot-or-not-dev-profile/`) is persistent across restarts — configured in `vite.config.js` — so swapping which worktree is active doesn't lose extension storage, the open reports tab, or other state.

**Spawn a new agent** from the main checkout: `npm run new-agent -- <slug>`. Then open a new terminal tab and run `npm run be-agent -- <slug>` — that tab becomes agent `<slug>`'s session and stays that agent for its entire lifetime. (Under the hood: `cd` into the worktree and `exec claude` there.)

**Check on live agents** from the orchestrator: `npm run agents` prints a one-row-per-agent table with unshipped commit count, working-tree state, and last commit subject.

**Make a worktree the active dev target** by asking the master orchestrator session. Use whatever phrasing — "switch dev to alice", "make alice active" — the orchestrator runs `npm run dev-switch -- alice` (kills the running dev server, starts a new one in alice's worktree). `-- --stop` and `-- --status` are also available.

**Ship an agent's work** from inside the agent's Claude session: `npm run ship`. This commits any pending diff, rebases `agent/<slug>` onto current `main`, fast-forwards `main`. The worktree and branch stay alive so the agent can immediately start the next feature. Rebase conflicts stop the script; resolve in the worktree, `git rebase --continue`, then re-run.

**Retire an agent** when you're truly done with it: `npm run retire-agent -- <slug>` from the main checkout. Removes the worktree and deletes the branch. Refuses if the agent has unshipped commits or uncommitted changes unless `-- --force` is passed.

The master orchestrator session (running in the main checkout) is itself long-lived. It spawns agents, switches the active dev target, retires agents, and publishes new versions. Agent sessions never touch the dev server (only the orchestrator does) and never publish.

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
