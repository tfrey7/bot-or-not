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
    rules: {
      curly: 'error',
    },
  },
  prettier,
];
