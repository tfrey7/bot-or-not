import { cpSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import webExtension from "vite-plugin-web-extension";

// The webext plugin processes manifest scripts/HTML, but does not walk
// manifest.icons / action.default_icon / web_accessible_resources to copy
// referenced image files. Copy the whole icons/ tree ourselves.
const copyIcons = () => ({
  name: "bon-copy-icons",
  apply: "build",
  closeBundle() {
    cpSync(resolve("icons"), resolve("dist/icons"), { recursive: true });
  },
});

export default defineConfig(({ mode }) => {
  // Bake the CLAUDE_API_KEY from .env into dev builds only so `npm run dev`
  // can auto-restore it after Firefox wipes extension storage on reload.
  // Production builds get null and the bootstrap branch in background.ts
  // tree-shakes out — the signed XPI never carries the key.
  const env = mode === "development" ? loadEnv(mode, process.cwd(), "") : {};
  const devClaudeApiKey =
    mode === "development" && env.CLAUDE_API_KEY ? env.CLAUDE_API_KEY : null;

  // Dev-only strand identity: when this build runs from inside a
  // ../<repo>-strands/<slug>/ worktree, the slug becomes __BON_STRAND__ so
  // the reports page can label which strand's code is loaded. Null in
  // production and when running from the main checkout — the consuming
  // code tree-shakes out.
  const parentDir = basename(dirname(process.cwd()));
  const inferredStrand = parentDir.endsWith("-strands")
    ? basename(process.cwd())
    : null;
  const devStrand = mode === "development" ? inferredStrand : null;

  // .strand.json is written by Claude from the Vibe Stranding MCP at strand
  // start. When present, its `color` syncs the badge to the plugin's color.
  // Missing file is normal (main checkout, or strand spawned before sync) —
  // the badge falls back to a hash-derived palette.
  let devStrandColor = null;
  if (devStrand) {
    try {
      const strandMeta = JSON.parse(
        readFileSync(resolve(process.cwd(), ".strand.json"), "utf8"),
      );
      devStrandColor =
        typeof strandMeta.color === "string" ? strandMeta.color : null;
    } catch {
      devStrandColor = null;
    }
  }

  return {
    plugins: [
      webExtension({
        manifest: "manifest.json",
        browser: "firefox",
        // reports.html is opened via browser.runtime.getURL from background.js,
        // not declared in the manifest, so list it here so Vite still builds it.
        additionalInputs: ["src/reports.html"],
        // The plugin only re-reads files it bundles, so manifest.json edits
        // (version bumps, permission changes) are invisible to dev mode
        // without listing it here. Same for the icons/ tree, which the
        // copyIcons plugin below ships to dist.
        watchFilePaths: ["manifest.json", "icons"],
        // Plugin bug workaround: getMultiPageConfig (used for HTML entries)
        // omits build.watch, so reports.html and its CSS/JS deps never rebuild
        // in `vite build --watch`. Force the watcher on in dev only.
        htmlViteConfig:
          mode === "development" ? { build: { watch: {} } } : undefined,
        webExtConfig: {
          startUrl: ["https://www.reddit.com/"],
          // Persistent profile shared across all worktrees so that switching
          // which worktree is live (scripts/dev.sh) doesn't lose extension
          // storage, the open reports tab, or other Firefox state.
          firefoxProfile: `${process.env.HOME}/.bot-or-not-dev-profile`,
          keepProfileChanges: true,
          // First-run prefs still useful for the very first launch when the
          // persistent profile doesn't exist yet.
          pref: {
            "browser.aboutwelcome.enabled": false,
            "browser.startup.homepage_override.mstone": "ignore",
            "startup.homepage_welcome_url": "",
            "startup.homepage_welcome_url.additional": "",
            "datareporting.policy.firstRunURL": "",
            "browser.startup.firstrunSkipsHomepage": true,
          },
        },
      }),
      copyIcons(),
    ],
    define: {
      __BON_DEV_CLAUDE_API_KEY__: JSON.stringify(devClaudeApiKey),
      __BON_STRAND__: JSON.stringify(devStrand),
      __BON_STRAND_COLOR__: JSON.stringify(devStrandColor),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // Keep the bundle readable so the AMO source-review reviewer (and us) can
      // diff it against the source.
      minify: false,
    },
  };
});
