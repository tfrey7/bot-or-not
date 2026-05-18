# Bot or Not — Claude Guidelines

## Dev Workflow

| Command | Purpose |
|---|---|
| `npm run dev` | Launch extension in Firefox (hot-reloads via web-ext) |
| `npm run lint` | Lint all `src/*.js` with ESLint |
| `npm run format` | Format all `src/*.js` with Prettier |
| `npm run build` | Build an unsigned extension zip into `web-ext-artifacts/` |
| `npm run sign` | Sign and publish to AMO (self-distribution, unlisted). Reads `AMO_API_KEY`/`AMO_API_SECRET` from `.env` |

Run `npm run lint` and `npm run format` before committing.

### Branching

- Work directly on `main` — do not create feature branches.
- Hold off on `git commit` until a change is confirmed working, then commit it to `main`.

### Release

1. Bump the version in **both** `manifest.json` and `package.json` (keep them in sync).
2. Run `npm run sign`.
3. Commit.
4. Tag the commit: `git tag vX.Y.Z` (matching the version you bumped to).
5. Push when ready: `git push && git push origin vX.Y.Z` (push the tag explicitly rather than `--tags` so stray local tags don't leak).

## Architecture

Three execution contexts, communicating via `browser.runtime.sendMessage`:

| Context | Files | Job |
|---|---|---|
| **Content script** | `src/content_script.js`, `src/content_script.css` | Runs on every Reddit page. Captures clicks on the report dialog, renders inline username tags in feeds/comments, injects the profile-page badge. |
| **Background (service worker)** | `src/background.js`, `src/bot_analysis.js`, `src/verdict.js` | Owns all storage I/O. Runs AI investigations via the Claude API. Sweeps orphaned in-flight investigations on startup. |
| **UI surfaces** | `src/reports.html/js` | Reports page (sort/filter/history) and its Settings modal (Claude API key). The toolbar button opens this page directly — there is no separate popup. Read state via background messages — never touch storage directly. |

### Bot analysis pipeline

- Triggered automatically when a user is reported, or on demand from the reports page.
- `src/bot_analysis.md` is the system prompt sent to Claude. Editing it changes how factors are scored.
- Claude returns 14 per-factor `{score, confidence, reasoning, evidence}` objects on a single bot↔human axis (`-1` = strong human signal, `+1` = strong bot signal), plus a top-level `persona: { label, reasoning }` block where `label` ∈ `{bot, stan, farmer, normal}`.
- `src/verdict.js` aggregates deterministically: `botProbability = sigmoid(2 × Σ(-score × confidence))`, then bins into one of 5 labels: `bot`, `likely-bot`, `uncertain`, `likely-human`, `human`.
- Verdict logic lives **only** in `verdict.js`. Don't bake it into the prompt or the background — re-running the aggregator on stored factor scores must reproduce the same verdict.
- **Persona is an LLM pick, not derived from factor math.** The bot↔human scalar and the persona answer different questions: a Stan or Farmer is still a human, so persona `stan`/`farmer` is consistent with a positive (human-leaning) verdict.

### Factor-list contract

- `src/factors.js` is the **canonical factor list** — keys and labels.
- `reports.js` reads from `BON_FACTORS` / `BON_FACTOR_KEYS` / `BON_FACTOR_LABELS` defined there.
- `src/bot_analysis.md` **must list factors in the same order with the same keys**. If you add/remove/rename a factor in `factors.js`, update the prompt file so Claude's output matches what the UI expects.

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
- All source files are ES modules — Vite bundles each entry point (`background.js`, `content_script.js`, `reports.html`) so content scripts can use `import` despite the manifest treating them as classic scripts.
- Profile-page badge injection is **idempotent** — check for `#bon-badge-container` before injecting. A **MutationObserver** handles Reddit's async SPA renders; disconnect it once injection succeeds.
- On background startup, investigations stuck at `status: "running"` are swept to `status: "error"` — the previous worker died mid-await (web-ext reload, browser restart, service-worker eviction) and won't be back to finish them.
- Inline username tags are keyed by **lowercase** username (Reddit's routing is case-insensitive).

## Code organization

Every screen and pipeline lives under `src/features/<feature>/`. Each directory IS the feature — drop the directory, remove the one or two imports from `src/content_script.js` / `src/background.js` / `src/reports.html`, and the feature is gone.

Current features: `analytics/`, `regions/`, `inline-tags/`, `reporting/`, `profile-panel/`, `status-detection/`, `reports/`, `investigation/`. Top-level survivors are intentional cross-feature contracts: `src/verdict.js` (the verdict-derivation math) and `src/factors.js` (the canonical factor + persona list both the analyzer and every UI consumes), plus the `src/utils/` helpers.

### File roles inside a feature

| File | Purpose |
|---|---|
| `index.js` | Public entry point. The renderer (`bonRenderX(...)`) for UI features, or the main public function for library features. May hold tiny render helpers (≤15 lines, called only from the entry function). |
| `logic.js` | Pure data transforms / aggregations — no DOM, no I/O. |
| `data.js` | Static lookup tables / constants. |
| `styles.css` | Feature CSS. |
| `<widget>.js` | One file per visible widget — e.g. `chart_cost.js`, `table_run_log.js`, `stat_grid.js`. One render function per file, named for what it builds. |

**Avoid grab-bag files.** If a file needs `// ---------- Section name ----------` dividers to navigate, the sections want to be separate files. Treat any such divider as a TODO to split. Splitting one file into many is fine — even small files. The locatability win (the IDE file tree becomes a TOC) outweighs the file-count cost.

**Separate business logic from rendering.** Pure transforms go in `logic.js`; DOM building goes in `index.js` or per-widget files. A function that computes summary stats and the function that paints them shouldn't share a file.

### Naming exported names

ES modules everywhere; cross-file communication is via `import` / `export` (no IIFE/`globalThis`).

- Every exported name gets the `bon` prefix so it's obvious in import lists where the symbol came from.
- **Feature-internal helpers** used by other files in the same feature get a `bon<Feature>` prefix (`bonAnalyticsSvgRoot`, `bonReportsRow`). The long name keeps ownership obvious and prevents collisions if another feature grows similar helpers.
- **Cross-feature utilities** go in `src/utils/<topic>.js` with a short `bon` prefix (`bonFmtUsd`, `bonExtractJson`).

### Refactoring guidelines (when asked to "feature-ify" something)

1. Survey the file to identify the seams (one widget = one render function = one file).
2. `git mv` the main file into `src/features/<feature>/index.js` to preserve history.
3. Pull pure data into `logic.js` / `data.js` first — these are the easiest extractions.
4. Pull each widget into its own file, exporting one `bon<Feature><Widget>` function.
5. Slim `index.js` to an orchestrator: data-load → call each widget → assemble. Keep page chrome (header/empty/footnote) inline if tiny.
6. Update any `import` sites in `background.js` / `content_script.js` / `reports.html` to point at the new feature path.
7. Run `npm run lint && npm run format && npm run build`. Done.

## Conventions

- All DOM IDs and CSS classes are prefixed `bon-` to avoid collisions with Reddit's styles.
- ID format: `bon-[noun]` (e.g., `#bon-badge`, `#bon-check-btn`).
- CSS modifier format: `bon-[noun]--[state]` (e.g., `.bon-stat-pill--verdict-bot`, `.bon-badge--bot`).
- Use **async/await** throughout — no `.then()` chains.
- Prefix every `console.log` / `console.error` with `[Bot or Not]`.
- Use `em` units for sizing so inline elements scale with surrounding Reddit text.
- Apply `transition: opacity 0.15s, transform 0.15s` to interactive elements.
- Prefer if/return chains over switch statements.
