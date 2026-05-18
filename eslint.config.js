import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "web-ext-artifacts/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
    },
  }
);
