---
name: update-deps
description: Survey out-of-date dependencies (npm packages + GitHub Actions versions) for this project and bump them with safety checks. Use when the user says "update deps", "bump dependencies", "check for outdated packages", or similar. This project does not run Dependabot — dependency updates happen on demand via this skill.
---

# update-deps

This project doesn't run Dependabot. Dependency updates happen on demand from inside Claude Code so the diff, the build, and any required migration land in one session.

GitHub's *security* alerts (CVE pings via the Security tab) are a separate system and stay on — this skill is for routine version drift only.

## Scope

- **npm packages** declared in `package.json`
- **GitHub Actions versions** pinned in `.github/workflows/*.yml`

## Procedure

### 1. Survey

```bash
npm outdated
```

For GH Actions, grep workflow files for `uses:` lines and check each pin against its current release (`gh release list --repo <owner>/<repo>` or WebFetch the GitHub releases page).

### 2. Classify each candidate

- **Patch / minor** — auto-bump
- **Major** — read the changelog first

### 3. Bump patch + minor

Edit `package.json` (or the `@vN` pin in workflow files), then run the project's verification:

```bash
npm install
npm run lint
npm run typecheck
npm run build
```

If everything passes, commit. Group related bumps into one commit (all GH Actions, all dev tooling, etc.) — not one commit per package, not one mega-commit mixing unrelated deps.

### 4. Major bumps

For each major:

1. WebFetch the package's GitHub releases page for the version range being crossed.
2. Check whether the project actually touches anything that changed. Grep for the broken API.
3. Propose a migration plan and ask the user before applying.
4. After ack: bump, update call sites, run the verification pipeline above.
5. Commit the bump + migration together. The commit body describes the migration.

### 5. Deferred majors

If a major's migration cost is high and the user wants to skip:

- Note it in the commit message of the current batch (`Skipping <package> v<N> — <reason>`).
- Don't silently leave it out. Future runs of this skill should know what was deliberately deferred.

## Commit messages

Match the project's existing style (see recent commits on `main`). Examples:

- `Bump GH Actions: checkout v6, setup-node v6` (grouped, single ecosystem)
- `Bump dev deps: eslint, prettier, typescript` (grouped, dev tooling)
- `Bump <package> v<old> → v<new>` (single major, body describes migration)

Follow `~/.claude/general/workflow.md` for branch placement — work on `main` by default; if the session is already on a strand, commit there.

## Don't

- Don't add `--legacy-peer-deps` or `--force` to silence `npm install`. Investigate the conflict.
- Don't edit `package-lock.json` by hand. Let `npm install` regenerate it.
- Don't bundle migration work for a major bump into a "minor/patch" sweep commit. Keep majors as their own commit so a revert is surgical.
