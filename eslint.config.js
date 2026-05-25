import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "web-ext-artifacts/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Feature-directory boundary enforcement. Imports targeting
    // `src/features/<feature>/...` from outside that feature must terminate
    // at the feature's `index.ts` — the package-private public surface.
    // Same-feature internal imports are unaffected.
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        {
          type: "feature",
          pattern: "src/features/*",
          mode: "folder",
          capture: ["name"],
        },
        {
          // Catch-all for everything else under src/ — entry points,
          // shared utils, top-level domain modules. Unconstrained by
          // the rule below; declared only so dependencies originating
          // here aren't classified as "unknown" and skipped.
          type: "other",
          pattern: "src/**/*",
          mode: "file",
        },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          rules: [
            {
              to: { type: "feature" },
              disallow: { to: { internalPath: "!(index.*)" } },
              message:
                "Cross-feature imports must terminate at the feature's index.ts (file ${to.internalPath} is feature-internal).",
            },
          ],
        },
      ],
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        window: "readonly",
        document: "readonly",
        browser: "readonly",
        location: "readonly",
        alert: "readonly",
        CSS: "readonly",
        MutationObserver: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        performance: "readonly",
        console: "readonly",
        URL: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLAnchorElement: "readonly",
        HTMLTableRowElement: "readonly",
        Node: "readonly",
        Element: "readonly",
        Event: "readonly",
        MouseEvent: "readonly",
        KeyboardEvent: "readonly",
        SVGElement: "readonly",
        SVGSVGElement: "readonly",
        DocumentFragment: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  prettier,
  {
    // After prettier — eslint-config-prettier disables `curly` as a "special
    // rule," so re-enable it explicitly with the "all" option (the only
    // setting prettier considers compatible).
    rules: {
      curly: ["error", "all"],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "block-like", next: "*" },
        {
          blankLine: "always",
          prev: "*",
          next: ["for", "while", "do"],
        },
        {
          blankLine: "always",
          prev: [
            "multiline-const",
            "multiline-let",
            "multiline-var",
            "multiline-expression",
          ],
          next: ["if", "switch", "try", "return", "throw"],
        },
      ],
      "lines-around-comment": [
        "error",
        {
          beforeLineComment: true,
          beforeBlockComment: true,
          allowBlockStart: true,
          allowObjectStart: true,
          allowArrayStart: true,
          allowClassStart: true,
        },
      ],
    },
  }
);
