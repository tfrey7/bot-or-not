import prettier from 'eslint-config-prettier';

export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        window: 'readonly',
        document: 'readonly',
        browser: 'readonly',
        CSS: 'readonly',
        MutationObserver: 'readonly',
      },
    },
  },
  prettier,
  {
    // After prettier — eslint-config-prettier disables `curly` as a "special
    // rule," so re-enable it explicitly with the "all" option (the only
    // setting prettier considers compatible).
    rules: {
      curly: ['error', 'all'],
    },
  },
];
