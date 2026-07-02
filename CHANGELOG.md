# Changelog

Notable changes to Bot or Not. Signed `.xpi` builds for each version are attached to the matching [GitHub Release](https://github.com/tfrey7/bot-or-not/releases).

## [8.1.0] — 2026-07-02
- Add Sonnet 5 pricing and correct Opus 4.7 rates
- Make Claude Sonnet 5 the default analysis model
- Add fixture-based investigation workflow
- Refine bot-detection heuristics from external research

## [8.0.0] — 2026-07-02
- Port the settings strip and sync panel to Preact
- Port the Redditors tab to Preact
- Port the Metrics (analytics) tab shell to Preact
- Port the Personas + Field Guide tabs to Preact
- Port the Subreddits tab to Preact (pilot)
- Add preact + JSX wiring for the reports-page pilot

## [7.10.0] — 2026-07-02
- Auto-unblock dead accounts to free Reddit block-list slots
- Skip flyout re-render when panel-visible data is unchanged

## [7.9.0] — 2026-07-01
- Keep persona label in slimmed report summaries
- Add automatic sync via private GitHub gist

## [7.8.0] — 2026-06-30
- Add weekly suspected-bot status re-check with tombstones
- Add "app" persona archetype for transparent automation
- Add "Suspected bots only" filter to the reports list
- Split storage into storage/ subdirectory by role
- Bump GH Actions: checkout v6 -> v7
- Bump @types/node v25 -> v26
- Bump dev deps: eslint, prettier, vite, typescript-eslint, playwright, web-ext

## [7.7.0] — 2026-06-30
- Load reports-page list from slim summaries; lazy-render heavy tabs

## [7.6.0] — 2026-06-04
- Export PersonaExemplar so the field guide tab compiles
- Add knip dead-code check (npm run deadcode)
- Remove dead code: unused functions, constants, types, and exports
- Add field guide tab
- Personas scatter: hexagonal rings + clamp points to the hexagon
- Rename persona archetypes: zealot→politics, stan→superfan, hustler→shill
- Skip analysis for hidden profiles until a dossier exists
- Replace cumulative-spend line with a spend-per-day bar chart

## [7.5.1] — 2026-06-04
- Decouple Reddit client from browser storage
- Bump dev deps: eslint, prettier, typescript-eslint, vite, web-ext, tsx, @types/node

## [7.5.0] — 2026-05-29
- Priority queuing: interactive investigations jump ahead of bulk sweeps

## [7.4.3] — 2026-05-29
- Shrink xpi from ~50 MB to ~12 MB

## [7.4.2] — 2026-05-29
- Reports page: stop refetching full storage every tick

## [7.4.1] — 2026-05-29
- Per-key report storage: stop the storage.onChanged jank storm

## [7.4.0] — 2026-05-25
- CLAUDE.md: drop the bon-prefix naming convention
- Strip the bon prefix from all JS/TS exports
- Forbid strand sessions from auto-claiming the dev singleton
- Drop Dependabot for an on-demand update-deps skill
- Storage: serialize report writes per username
- Subreddit analyze: batch enqueue into a single reports write
- Bump actions/setup-node from 4 to 6 (#3)
- Merge pull request #2 from tfrey7/dependabot/github_actions/dependabot/fetch-metadata-3
- Merge pull request #1 from tfrey7/dependabot/github_actions/actions/checkout-6
- Bump the dev-minor-patch group with 4 updates (#4)
- Bump dependabot/fetch-metadata from 2 to 3
- Bump actions/checkout from 4 to 6

## [7.3.0] — 2026-05-25
- Fix broken README masthead — point at chromes-investigating.webp
- Dependabot: weekly grouped updates with cooldowns + CI auto-merge
- Enforce feature directory boundaries via ESLint
- Attribution worker: switch to p-queue + p-retry
- Investigation queue: switch to p-queue + p-retry
- Reddit client: replace hand-rolled scheduler with p-queue
- Slideshow jitter: coalesce storage events, slim slideshow assets to WebP
- Dev badge: STRAND · <slug> on strand worktrees, DEV · MAIN on main
- Wrap up cost-optimization
- Trim AI payload: 200-char bodies, drop content-less items
- Investigation cache: bump TTL 5m → 1h
- Reddit client: proactive pacing via x-ratelimit-* headers
- Subreddits tab: loading state for in-flight analysis
- Subreddits tab: match Redditors styling
- Add .mcp.json registering vibe-stranding MCP server
- Queue: stop stalling on Reddit overload
- Wrap up agent-cleanup

## [7.2.0] — 2026-05-23
- Pause indicator: move from page banner to queue section
- Privacy: harden username redaction against AI deblurring
- Subreddits tab: split list + detail pane
- Subreddit analysis: source authors from /new.json, not the DOM
- Reddit client: global concurrency cap + 429 pause
- Pagination: drop button labels, keep arrows only
- Detail pane: skip rebuild when only sibling rows changed
- Inline tags: skip anchors inside Reddit's left sidebar
- CLAUDE.md: require writing-code skill before code edits
- Privacy blur: extend to cake day, karma, and Human/Bot signal lists
- Redditors detail: move user notes to the bottom of the panel

## [7.1.0] — 2026-05-22
- Redditors tab: rename from Reports, reorder nav, split feature dir
- README: capture reports + dossier screenshots
- Queue: pause requeued investigations when upstream returns 429 + Retry-After
- README: add Playwright screenshot capture (Phase 2)
- Docs: remove stale IDEAS.md
- README: add regeneratable pipeline
- Add subreddit-compromise detection: Reddit-side analyze widget + Reports-page Subreddits tab
- Publish flow: auto-generate CHANGELOG.md from per-feature commits
- Investigation: score six factors deterministically in TS
- AI command: add set_pii_blur tool
- Privacy: blur usernames + avatars for screenshot mode
- Inline tags: escape Reddit's username-text wrappers before inserting the pill
- Manifest: drop unused DuckDuckGo host permission
- Inline tags: skip /user/ anchors inside a post body

## [6.8.0] — 2026-05-22
- Detail pane: noir Chromes art for the queued state
- Remove Diagnostics tab; surface storage in Settings, queue pressure in Reports
- Reports profile header: show last investigation's duration + cost
- Username links: navigate to the in-app reports detail, not Reddit
- Personas: consolidate UI copy on "persona" instead of mixing with "archetype"
- Remove fun-facts tab and feature
- Personas: add "About the archetypes" reference grid below the scatter
- Extract provider-agnostic LLM layer at src/llm/
- Google harvest: gate behind optional permission, off by default for new installs
- Content script: stay dormant until a Claude API key is set
- Settings: Clear All also wipes the saved Claude API key

## [6.7.0] — 2026-05-21
- Investigation: compact columnar JSON for the AI payload (sub dedup, drop nulls, epoch-minute timestamps)
- Format closeConfirmModal signature per Prettier
- Action bar: load reports snapshot lazily via list_users tool
- Gate destructive AI-command tools through an operator confirm modal
- Add scripts/cost-experiment.ts: A/B harness for investigation variants
- Investigation: cut payload to 300 items/kind and epoch-encode per-item timestamps
- Format: collapse storage import in background.ts to single line
- Remove the late-night jazz mascot Easter egg
- Remove the dev reference-account seed list

## [6.6.0] — 2026-05-21
- Reports: lower split-stack breakpoint from 82em to 60em
- Split reports.css into per-widget chunks
- Slim persona taxonomy to 6 axes; route age to new Demographics block
- Extract BonStorage and BonClient adapters to isolate browser APIs
- Compress AI investigation payload to cut Claude cost ~50%
- Treat US + Israel as diaspora-attracting in residency inference
- Drop the timezone-only region fallback
- Detail header: hoist region badge next to verdict, drop region section
- Reports table: drop region + persona tags, leave bot status
- Stop re-rendering the profile dossier on cosmetic harvest bumps
- Route Investigation reads through bonInvestigationResults helper
- Feature-ify regions and reports: split signal modules
- Add agents status table and be-agent identity command

## [6.5.0] — 2026-05-21
- Turn the AI command bar into a streaming chat modal
- Use prettier --check in commit hook so unformatted code blocks
- Discriminate Investigation on status for type-level result narrowing
- Add PreToolUse hook: typecheck/lint/format before git commit
- Accept main as a dev-switch target
- Keep personas scatter dots inside the disk and color-true to label
- Add a Fun Facts tab surfacing rarities across the corpus

## [6.4.0] — 2026-05-21
- Wire the Personas tab into the reports orchestrator
- Add a filter-criteria label to the AI command filter badge
- Expose persona, factor scores, and account-shape fields to the AI command snapshot
- Add Personas tab: scatter every investigated account in archetype-space
- Split reports/index.ts orchestrator into focused modules
- Migrate analytics charts to uplot
- Make the header input a pure command box
- Auto-open the reports tab on dev startup for agent worktrees
- Keep the investigation loading overlay behind the sticky profile bar
- Show agent identity in dev: tab title prefix + masthead badge
- Drop factor-dot strip and missing-slot placeholders from report rows
- Render a Sherlock Chromes panel when Reddit 404s on a username
- Drop main-clean check from new-agent
- Auto-pick agent name when no slug is given
- Switch worktree workflow to long-lived agents
- Add dev-switch script and persistent Firefox profile
- Drop trailing slash on node_modules ignore so symlinked worktrees are also ignored
- Add worktree-based parallel-agent workflow

## [6.3.0] — 2026-05-20
- Sticky profile header
- Three-slot inline username tags
- No-thrash refresh

## [6.2.0] — 2026-05-20
- Passive harvest from Reddit profile pages
- Google attribution surfaced in dossier
- Multi-pick personas

## [6.1.0] — 2026-05-20
- Clipboard sync for cross-device handoff
- URL-persisted tabs in reports
- Quoted Google searches for exact-phrase matches

## [6.0.0] — 2026-05-20
- Google dossier: user-triggered harvest of search results for context
- Cross-device sync of reports + settings
- Self-improvement loop: AI proposes prompt edits from disagreements
- Persona icons in reports table

## [5.0.0] — 2026-05-19
- AI command bar: natural-language queries over the reports corpus
- DuckDuckGo web-search enrichment in the investigation pipeline
- Region inference rework: residency + timezone signals, not language alone
- Persona/factor scoring tweaks

## [4.0.0] — 2026-05-18
- Reports page overhaul: tabbed UI (Overview, Detail, Analytics, Diagnostics)
- Ring linking: surface coordinated-account clusters in the detail pane
- Diagnostics tab for queue/storage/API observability
- Persona rework

## [3.11.0] — 2026-05-18
- Operator-collected dossier: paste outside context into the investigation
- Apply region-inference rule to operator-collected context

## [3.10.2] — 2026-05-18
- Fix browser freeze when SPA-navigating into busy threads
- Document self-distribution release flow
- Polish reports page and tighten dev-mode workflow
- Switch dev script to vite dev so web-ext auto-reloads the extension
- Stop tracking .idea/ IDE state
- Remove stale .js files left over from TypeScript migration
- Apply whitespace-paragraph style across source

## [3.10.0] — 2026-05-18
- Convert codebase from JavaScript to TypeScript

## [3.0] — 2026-05-18
- Feature-ify content_script, reports, and the investigation pipeline into `src/features/<feature>/`
- Document release tagging in CLAUDE.md
- Convert all source files to ES modules
- Migrate build to Vite (keeping IIFE + globalThis pattern at the time)
- Move analytics + regions into feature directories
- Enforce curly braces on all if/else statements
- Extract pure helpers into src/utils/, kill pricing duplication

## [2.0] — 2026-05-18
- Drop the triangle classifier in favor of a scalar bot↔human verdict
- Introduce Sherlock Chromes mascot and noir aesthetic
- Aggregate per-factor scores deterministically in `verdict.ts`
