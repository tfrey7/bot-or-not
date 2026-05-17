# Bot or Not — Claude Guidelines

## Dev Workflow

| Command | Purpose |
|---|---|
| `npm run dev` | Launch extension in Firefox (hot-reloads on file changes via web-ext) |
| `npm run lint` | Lint `content_script.js` with ESLint |
| `npm run format` | Format `content_script.js` with Prettier |

Run `npm run lint` and `npm run format` before committing.

### Branching

- Work directly on `main` — do not create feature branches.
- Hold off on `git commit` until a change is confirmed working, then commit it to `main`.

## Architecture & Patterns

### Content Script Structure

- The content script is wrapped in an **IIFE** — keep it that way. Do not convert to ES module syntax. Content scripts cannot use top-level `import` even though `package.json` has `"type": "module"`.
- A **guard clause** at the top matches the URL and returns early if not on a Reddit profile page (`/u/` or `/user/`).
- Badge injection is **idempotent** — always check for `document.getElementById("bon-badge-container")` before injecting.
- A **MutationObserver** handles Reddit's SPA navigation (the DOM renders asynchronously). Always disconnect the observer once injection succeeds.

### State Management

- The `STATES` object holds all state-specific metadata: icon URL, title text, and next state key.
- All badge DOM mutations must go through `applyState()` — never update badge properties directly.

### Storage

- Use `browser.storage.local` for persistence.
- Storage format: `{ bots: ["username1", "username2", ...] }` (only bot-flagged usernames stored).
- Always destructure with a default when reading: `{ bots = [] }`.
- Deduplicate with `new Set()` when adding a username; use `Array.filter()` when removing.

### Async Style

- Use **async/await** throughout — avoid `.then()` chains.

### Naming Conventions

- All DOM IDs and CSS classes are prefixed with `bon-` to avoid collisions with Reddit's styles.
- ID format: `bon-[noun]` (e.g., `#bon-badge`, `#bon-badge-container`, `#bon-check-btn`)
- CSS modifier format: `bon-[noun]--[state]` (e.g., `.bon-badge--bot`, `.bon-badge--not-bot`)

### Logging

- Prefix all `console.log` / `console.error` calls with `[Bot or Not]`.

### CSS

- Use `em` units for sizing so elements scale with the surrounding font.
- Apply `transition: opacity 0.15s, transform 0.15s` to interactive elements.
