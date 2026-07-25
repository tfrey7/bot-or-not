---
name: publish
description: Publish a new version of the extension — version bump, sign, updates.json/CHANGELOG, tag, push, GitHub release with the signed .xpi. Use when the user says "publish", "mint", "release a new version", or "publish X.Y.Z". Operates on main once all desired strands have been shipped.
---

# Publish a new version

Operates on `main` once all desired features have been shipped. Commit message convention is `Publish X.Y.Z: <one-line summary>` (historically these said `Ship X.Y.Z:` — old vocabulary). Per the user's standing preference, run the pipeline as a backgrounded Bash chain so the session stays responsive. **Chain the steps with `&&`, not `set -e`** — `set -e` does not reliably abort in the eval'd shell context, and a sign failure must not let the commit/tag/push steps run (this caused a partial publish once).

**If `npm run sign` fails with "Version X.Y.Z already exists":** a previous interrupted run's upload reached AMO. Don't re-upload — check the version's file status via the AMO API (JWT auth from `AMO_API_KEY`/`AMO_API_SECRET` in `.env`) and, once `public`, download the signed file to `web-ext-artifacts/fe5aa4514b5d4cb3aa94-X.Y.Z.xpi`, then continue from step 3.

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
