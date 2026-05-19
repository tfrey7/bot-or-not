# Bot or Not — Claude Guidelines

@~/Development/.claude/languages/typescript.md

## Dev Workflow

| Command             | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Launch extension in Firefox (hot-reloads via web-ext)                                                   |
| `npm run lint`      | Lint all `src/**/*.{ts,js}` with typescript-eslint                                                      |
| `npm run format`    | Format all `src/**/*.{ts,js}` with Prettier                                                             |
| `npm run typecheck` | Run `tsc --noEmit` against `src/**/*.ts`                                                                |
| `npm run build`     | Build an unsigned extension zip into `web-ext-artifacts/`                                               |
| `npm run sign`      | Sign and publish to AMO (self-distribution, unlisted). Reads `AMO_API_KEY`/`AMO_API_SECRET` from `.env` |

Run `npm run typecheck`, `npm run lint`, and `npm run format` before committing.

### Branching

- Work directly on `main` — do not create feature branches.
- Hold off on `git commit` until a change is confirmed working, then commit it to `main`.

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

| Context                         | Files                                                                 | Job                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Content script**              | `src/content_script.ts`, `src/content_script.css`                     | Runs on every Reddit page. Captures clicks on the report dialog, renders inline username tags in feeds/comments, injects the profile-page badge.                                                                         |
| **Background (service worker)** | `src/background.ts`, `src/features/investigation/*`, `src/verdict.ts` | Owns all storage I/O. Runs AI investigations via the Claude API. Sweeps orphaned in-flight investigations on startup.                                                                                                    |
| **UI surfaces**                 | `src/reports.html` + `src/features/reports/*.ts`                      | Reports page (sort/filter/history) and its Settings modal (Claude API key). The toolbar button opens this page directly — there is no separate popup. Read state via background messages — never touch storage directly. |

### Bot analysis pipeline

- Triggered automatically when a user is reported, or on demand from the reports page.
- `src/features/investigation/prompt.md` is the system prompt sent to Claude. Editing it changes how factors are scored.
- Claude returns 14 per-factor `{score, confidence, reasoning, evidence}` objects on a single bot↔human axis (`-1` = strong human signal, `+1` = strong bot signal), plus a top-level `persona: { label, reasoning }` block where `label` ∈ `{bot, stan, farmer, normal}`.
- `src/verdict.ts` aggregates deterministically: `botProbability = sigmoid(2 × Σ(-score × confidence))`, then bins into one of 5 labels: `bot`, `likely-bot`, `uncertain`, `likely-human`, `human`.
- Verdict logic lives **only** in `verdict.ts`. Don't bake it into the prompt or the background — re-running the aggregator on stored factor scores must reproduce the same verdict.
- **Persona is an LLM pick, not derived from factor math.** The bot↔human scalar and the persona answer different questions: a Stan or Farmer is still a human, so persona `stan`/`farmer` is consistent with a positive (human-leaning) verdict.

### Factor-list contract

- `src/factors.ts` is the **canonical factor list** — keys and labels.
- The reports feature reads from `BON_FACTORS` / `BON_FACTOR_KEYS` / `BON_FACTOR_LABELS` defined there.
- `src/features/investigation/prompt.md` **must list factors in the same order with the same keys**. If you add/remove/rename a factor in `factors.ts`, update the prompt file so Claude's output matches what the UI expects.

### Storage shape

Two top-level keys in `browser.storage.local`: `reports` and `claudeApiKey`.

```js
{
  reports: {
    [username]: {
      count,              // # of times the user reported this account
      history,            // [{ reportedAt, kind, permalink, subreddit, ... }]
      investigation,      // see below; may be absent until investigated
      userStatus,         // "active" | "suspended" | null
      botBouncerStatus,   // "banned" | "organic" | null
      userCreatedAt,      // unix seconds; populated lazily
    }
  },
  claudeApiKey: "sk-...",
}
```

Investigation shape:

```js
{
  status: "running" | "done" | "error",
  startedAt, durationMs, error,
  verdict, confidence, botProbability,  // derived by verdict.js
  factors: [{ key, score, confidence, reasoning, evidence }, ...],
  persona: { label, reasoning } | null,  // LLM-picked archetype
  summary,
}
```

## Patterns

- **Storage I/O is background-only.** Content script, popup, and reports page all message the background (`get-user-report`, `update-user-status`, …). Do not call `browser.storage.local` from anywhere else.
- All source files are TypeScript ES modules — Vite bundles each entry point (`background.ts`, `content_script.ts`, `reports.html`) so content scripts can use `import` despite the manifest treating them as classic scripts.
- Shared domain types (`Report`, `Investigation`, `Factor`, `Persona`, `ActivityData`, etc.) live in `src/types.ts`. Reference them from any file via `import type { ... } from "../types.ts"` (use the `.ts` extension — Vite + `allowImportingTsExtensions` handles it).
- Profile-page badge injection is **idempotent** — check for `#bon-badge-container` before injecting. A **MutationObserver** handles Reddit's async SPA renders; disconnect it once injection succeeds.
- On background startup, investigations stuck at `status: "running"` are swept to `status: "error"` — the previous worker died mid-await (web-ext reload, browser restart, service-worker eviction) and won't be back to finish them.
- Inline username tags are keyed by **lowercase** username (Reddit's routing is case-insensitive).

## Code organization

Every screen and pipeline lives under `src/features/<feature>/`. Each directory IS the feature — drop the directory, remove the one or two imports from `src/content_script.ts` / `src/background.ts` / `src/reports.html`, and the feature is gone.

Current features: `analytics/`, `regions/`, `inline-tags/`, `reporting/`, `profile-panel/`, `status-detection/`, `reports/`, `investigation/`. Top-level survivors are intentional cross-feature contracts: `src/verdict.ts` (the verdict-derivation math), `src/factors.ts` (the canonical factor + persona list), and `src/types.ts` (shared domain types), plus the `src/utils/` helpers.

### File roles inside a feature

| File          | Purpose                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`    | Public entry point. The renderer (`bonRenderX(...)`) for UI features, or the main public function for library features. May hold tiny render helpers (≤15 lines, called only from the entry function). |
| `logic.ts`    | Pure data transforms / aggregations — no DOM, no I/O. Feature-internal types live here too.                                                                                                            |
| `data.ts`     | Static lookup tables / constants.                                                                                                                                                                      |
| `styles.css`  | Feature CSS.                                                                                                                                                                                           |
| `<widget>.ts` | One file per visible widget — e.g. `chart_cost.ts`, `table_run_log.ts`, `stat_grid.ts`. One render function per file, named for what it builds.                                                        |

**Avoid grab-bag files.** If a file needs `// ---------- Section name ----------` dividers to navigate, the sections want to be separate files. Treat any such divider as a TODO to split. Splitting one file into many is fine — even small files. The locatability win (the IDE file tree becomes a TOC) outweighs the file-count cost.

**Separate business logic from rendering.** Pure transforms go in `logic.js`; DOM building goes in `index.js` or per-widget files. A function that computes summary stats and the function that paints them shouldn't share a file.

### Naming exported names

ES modules everywhere; cross-file communication is via `import` / `export` (no IIFE/`globalThis`).

- Every exported name gets the `bon` prefix so it's obvious in import lists where the symbol came from.
- **Feature-internal helpers** used by other files in the same feature get a `bon<Feature>` prefix (`bonAnalyticsSvgRoot`, `bonReportsRow`). The long name keeps ownership obvious and prevents collisions if another feature grows similar helpers.
- **Cross-feature utilities** go in `src/utils/<topic>.ts` with a short `bon` prefix (`bonFmtUsd`, `bonExtractJson`).
- TypeScript domain types are also `bon`-free (just `Report`, `Investigation`, `Factor`, etc.) since they're already namespaced by the `types.ts` import path.

### Refactoring guidelines (when asked to "feature-ify" something)

1. Survey the file to identify the seams (one widget = one render function = one file).
2. `git mv` the main file into `src/features/<feature>/index.ts` to preserve history.
3. Pull pure data into `logic.ts` / `data.ts` first — these are the easiest extractions.
4. Pull each widget into its own file, exporting one `bon<Feature><Widget>` function.
5. Slim `index.ts` to an orchestrator: data-load → call each widget → assemble. Keep page chrome (header/empty/footnote) inline if tiny.
6. Update any `import` sites in `background.ts` / `content_script.ts` / `reports.html` to point at the new feature path.
7. Run `npm run typecheck && npm run lint && npm run format && npm run build`. Done.

## Conventions

- All DOM IDs and CSS classes are prefixed `bon-` to avoid collisions with Reddit's styles.
- ID format: `bon-[noun]` (e.g., `#bon-badge`, `#bon-check-btn`).
- CSS modifier format: `bon-[noun]--[state]` (e.g., `.bon-stat-pill--verdict-bot`, `.bon-badge--bot`).
- Use **async/await** throughout — no `.then()` chains.
- Prefix every `console.log` / `console.error` with `[Bot or Not]`.
- Use `em` units for sizing so inline elements scale with surrounding Reddit text.
- Apply `transition: opacity 0.15s, transform 0.15s` to interactive elements.
- Prefer if/return chains over switch statements.
