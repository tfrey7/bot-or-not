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

- Bump the version in **both** `manifest.json` and `package.json` (keep them in sync).
- Run `npm run sign`, then commit.

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
- Claude returns 12 per-factor `{score, confidence, reasoning}` objects on a single bot↔human axis (`-1` = strong human signal, `+1` = strong bot signal).
- `src/verdict.js` aggregates deterministically: `botProbability = sigmoid(2 × Σ(-score × confidence))`, then bins into one of 5 labels: `bot`, `likely-bot`, `uncertain`, `likely-human`, `human`.
- Verdict logic lives **only** in `verdict.js`. Don't bake it into the prompt or the background — re-running the aggregator on stored factor scores must reproduce the same verdict.

### Factor-list contract

- `src/factors.js` is the **canonical factor list** — keys, labels, and per-factor metadata (e.g., `triangleVertices` for the beta triangle classifier).
- All UI surfaces (`reports.js`, `reports_triangle.js`) read from `BON_FACTORS` / `BON_FACTOR_KEYS` / `BON_FACTOR_LABELS` defined there.
- `src/bot_analysis.md` (the 1D prompt) and `src/triangle/bot_analysis_triangle.md` (the triangle prompt) **must list factors in the same order with the same keys**. If you add/remove/rename a factor in `factors.js`, update both prompt files so Claude's output matches what the UI expects.

### Triangle classifier (beta)

A second, experimental classifier runs in parallel with the 1D bot/not analysis. Files all live under `src/triangle/`:

- `bot_analysis_triangle.md` — the system prompt. Places accounts on a barycentric Bot / Stan / Farmer triangle. Per factor, asks Claude to score only the vertices declared in `factors.js` (e.g., `hidden_post_history` returns just `{bot, confidence}`; `engagement_patterns` returns `{bot, stan, farmer, confidence}`).
- `bot_analysis_triangle.js` — analyzer. Loads the prompt, calls Claude using shared helpers (`bonCallClaude`, `bonExtractJson` from `bot_analysis.js`), reduces the response via `bonComputeTriangle`.
- `verdict_triangle.js` — aggregator. Confidence-weighted average per corner across factors *eligible* for that corner (handles the asymmetry where Bot has many more eligible factors than Stan/Farmer).
- `triangle_widget.js` + `triangle.css` — SVG widget rendered on the beta page.

**Pipeline.** `handleInvestigateUser` in `background.js` fetches the profile once (`bonGatherProfile`), then fires both analyses in parallel:

```js
const inputs = await bonGatherProfile(username, extra);
const [oneD, triResult] = await Promise.all([
  bonRunOneDAnalysis(apiKey, inputs.summary),
  bonInvestigateUserTriangle(apiKey, inputs.summary).catch(() => null),
]);
```

The triangle call's failure is allowed-to-fail — bad JSON shouldn't tank the whole investigation. Investigation storage gets `investigation.triangle` (the `{bot, stan, farmer}` blend) and `investigation.triangleFactors` (per-factor scores) additively; nothing existing changes.

**Beta UI** lives at `src/reports_triangle.html` + `src/reports_triangle.js` and is reachable from the main reports page via the "Triangle view BETA" header button. To delete the beta entirely: remove the `src/triangle/` directory, the two `reports_triangle.*` files, the triangle script entries from `manifest.json` background list, and the header button in `src/reports.html`.

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
  factors: [{ name, score, confidence, reasoning }, ...],
  summary,
}
```

## Patterns

- **Storage I/O is background-only.** Content script, popup, and reports page all message the background (`get-user-report`, `update-user-status`, …). Do not call `browser.storage.local` from anywhere else.
- The content script is wrapped in an **IIFE**. Do not convert to ES modules — content scripts can't use top-level `import` even though `package.json` has `"type": "module"`.
- Profile-page badge injection is **idempotent** — check for `#bon-badge-container` before injecting. A **MutationObserver** handles Reddit's async SPA renders; disconnect it once injection succeeds.
- On background startup, investigations stuck at `status: "running"` are swept to `status: "error"` — the previous worker died mid-await (web-ext reload, browser restart, service-worker eviction) and won't be back to finish them.
- Inline username tags are keyed by **lowercase** username (Reddit's routing is case-insensitive).

## Conventions

- All DOM IDs and CSS classes are prefixed `bon-` to avoid collisions with Reddit's styles.
- ID format: `bon-[noun]` (e.g., `#bon-badge`, `#bon-check-btn`).
- CSS modifier format: `bon-[noun]--[state]` (e.g., `.bon-stat-pill--verdict-bot`, `.bon-badge--bot`).
- Use **async/await** throughout — no `.then()` chains.
- Prefix every `console.log` / `console.error` with `[Bot or Not]`.
- Use `em` units for sizing so inline elements scale with surrounding Reddit text.
- Apply `transition: opacity 0.15s, transform 0.15s` to interactive elements.
- Prefer if/return chains over switch statements.
