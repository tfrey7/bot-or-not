# Bot or Not — Spec

## What it does
A browser extension that lets you manually flag Reddit accounts as bots. Flagged accounts are visually marked with a badge icon next to their username.

## Current scope (v1)
- **Surfaces:** Reddit user profile pages only (`/u/username`, `/user/username`)
- **Detection:** Manual only — the user clicks the badge to toggle an account between "not-bot" (default) and "bot"
- **Storage:** `browser.storage.local` — local to this browser, no sync, no backend

## Data model
```js
// browser.storage.local
{ bots: ["spambot123", "sus_account"] }
```
- Only bot-labeled accounts are stored; "not-bot" is the default
- Keyed by Reddit username (case-sensitive, as returned by the URL)

## Out of scope for v1
- Automatic bot detection / heuristics
- Reddit API calls
- Comment thread / feed badges (not just profile pages)
- Cross-device sync
- Sharing or exporting labels

## File map
| File | Purpose |
|---|---|
| `manifest.json` | Extension config, permissions |
| `content_script.js` | Badge injection + storage read/write |
| `content_script.css` | Badge styles |
| `popup.html` | Toolbar popup (static, informational only) |
| `icon-bot.svg` | Bot badge icon |
| `icon-not-bot.svg` | Not-bot badge icon |
