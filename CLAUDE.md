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
| `npm run investigate -- <username> [--no-web-search] [--json]` | Run the bot/human investigation pipeline against a Reddit username outside the extension. Lets you iterate on `src/features/investigation/prompt.md` without rebuilding. Reads `CLAUDE_API_KEY` from `.env` (gitignored). |

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
- Claude returns 15 per-factor `{score, confidence, reasoning, evidence}` objects on a single bot↔human axis (`-1` = strong human signal, `+1` = strong bot signal), plus a top-level `persona: { label, reasoning, archetypes }` block. `label` is one of `{bot, normal}` or one of the human-flavor archetypes defined in `src/factors.ts` (currently `stan`, `farmer`, `teen`, `thirst`, `crank`, `hustler`, `doomer`). `archetypes` is a 0–1 strength score per archetype axis, used by the reports-page radar chart.
- `src/verdict.ts` aggregates deterministically: `botProbability = sigmoid(2 × Σ(-score × confidence))`, then bins into one of 5 labels: `bot`, `likely-bot`, `uncertain`, `likely-human`, `human`.
- Verdict logic lives **only** in `verdict.ts`. Don't bake it into the prompt or the background — re-running the aggregator on stored factor scores must reproduce the same verdict.
- **Persona is an LLM pick, not derived from factor math.** The bot↔human scalar and the persona answer different questions: archetypes describe flavors of *human* behavior, so a `stan` / `farmer` / `crank` / etc. persona is consistent with a positive (human-leaning) verdict. `bot` is a valid label but not a radar axis — the bot↔human scalar already answers that.
- Archetype list is canonical in `src/factors.ts` (`BON_ARCHETYPES`). Adding/removing/renaming an archetype must be mirrored in `src/features/investigation/prompt.md` so Claude's `persona.archetypes` keys match what the radar expects.

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
  persona: { label, reasoning, archetypes } | null,  // LLM pick + 0–1 per-axis strengths
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

Every screen and pipeline lives under `src/features/<feature>/`. Each directory IS the feature — drop the directory, remove the one or two imports from `src/content_script.ts` / `src/background.ts` / `src/reports.html`, and the feature is gone. Top-level survivors are intentional cross-feature contracts: `src/verdict.ts` (the verdict-derivation math), `src/factors.ts` (the canonical factor + persona list), and `src/types.ts` (shared domain types), plus the `src/utils/` helpers.

General file-role and structure rules (`index.ts`, `logic.ts`, `data.ts`, `<widget>.ts`; avoid grab-bag files; separate logic from rendering) live in the `writing-code` Skill.

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

## Project-specific conventions

- DOM/CSS prefix is `bon-`.
- Console log tag is `[Bot or Not]`.

General code style, naming, comments, and TypeScript conventions live in the `writing-code` Skill.
