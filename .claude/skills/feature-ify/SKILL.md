---
name: feature-ify
description: Refactor a grab-bag source file into a feature directory under src/features/. Use when the user asks to "feature-ify" a file, split up a large file, or move a screen/pipeline into the feature-directory structure.
---

# Feature-ify a file

Refactoring steps for moving a file into the `src/features/<feature>/` structure (general file-role rules live in the `writing-code` skill):

1. Survey the file to identify the seams (one widget = one render function = one file).
2. `git mv` the main file into `src/features/<feature>/index.ts` to preserve history.
3. Pull pure data into `logic.ts` / `data.ts` first — these are the easiest extractions.
4. Pull each widget into its own file, exporting one render function named for the widget.
5. Slim `index.ts` to an orchestrator: data-load → call each widget → assemble. Keep page chrome (header/empty/footnote) inline if tiny.
6. Update any `import` sites in `background.ts` / `content_script.ts` / `reports.html` to point at the new feature path.
7. Run `npm run typecheck && npm run lint && npm run format && npm run build`. Done.
