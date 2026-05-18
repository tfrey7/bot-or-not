import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
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

export default defineConfig(({ mode }) => ({
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
      },
    }),
    copyIcons(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Keep the bundle readable so the AMO source-review reviewer (and us) can
    // diff it against the source.
    minify: false,
  },
}));
