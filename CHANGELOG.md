# Changelog

Notable changes to Bot or Not. Signed `.xpi` builds for each version are attached to the matching [GitHub Release](https://github.com/tfrey7/bot-or-not/releases).

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
